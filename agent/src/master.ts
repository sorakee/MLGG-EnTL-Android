// Port of MasterText.cs: walk the MemoryDB tables the pack has text for and swap the string fields named in
// its "master" section for English, in place. A table is walked again only when it changes (another table
// object, count, or first/last row). Shapes: "Field" a string, "Field[]" an array (strings, or objects whose
// string fields are swapped), "Field{}" a Dictionary<enum, string>.
// Display only: ids are never touched and nothing goes back to the server.
//
// Speed: the bridge's generic calls cost ~80 µs each, which made the first pass a 12 s freeze. Fields are read
// and written straight from memory (writes through il2cpp's GC write barrier), table rows through native
// calls, and the work is spread over frames (BUDGET_MS per frame).
import { ctx } from "./ctx.js";
import { cls } from "./game.js";
import * as log from "./log.js";
import type { Map, Store } from "./store.js";

const BUDGET_MS = 6;
const CHECK_EVERY_MS = 2000;
const STRING_LENGTH = 16, STRING_CHARS = 20;  // Il2CppString: klass, monitor, int32 length, UTF-16 chars
const ARRAY_LENGTH = 24, ARRAY_DATA = 32;     // Il2CppArray: klass, monitor, bounds, max_length, data

// Resolved on first use: in script mode the agent loads before libil2cpp.so does. Through the bridge's module:
// looking a module up by name on the main thread can deadlock with a library load in progress (see index.ts).
let wbarrierFn: NativeFunction<void, [NativePointerValue, NativePointerValue, NativePointerValue]> | null = null;
function wbarrier(obj: NativePointer, at: NativePointer, value: NativePointer): void {
    wbarrierFn ??= new NativeFunction(Il2Cpp.module.getExportByName("il2cpp_gc_wbarrier_set_field"),
        "void", ["pointer", "pointer", "pointer"]);
    wbarrierFn(obj, at, value);
}

function readString(p: NativePointer): string | null {
    if (p.isNull()) return null;
    return p.add(STRING_CHARS).readUtf16String(p.add(STRING_LENGTH).readS32());
}

const newString = (s: string) => Il2Cpp.string(s).handle;

type Shape = "plain" | "list" | "dict";

/** A C# property's storage: its backing field's offset (fast), else get_/set_ methods through the bridge. */
interface Slot {
    offset: number | null;
    type: Il2Cpp.Type;
    getter?: string;
    setter?: string;
}

function slot(klass: Il2Cpp.Class, name: string): Slot | null {
    for (let c: Il2Cpp.Class | null = klass; c !== null; c = c.parent) {
        const f = c.tryField(`<${name}>k__BackingField`) ?? c.tryField(name);
        if (f && !f.isStatic) return { offset: f.offset, type: f.type };
        const g = c.tryMethod(`get_${name}`, 0);
        const s = c.tryMethod(`set_${name}`, 1);
        if (g && s) return { offset: null, type: g.returnType, getter: g.name, setter: s.name };
    }
    return null;
}

function getRef(obj: NativePointer, s: Slot): NativePointer {
    if (s.offset !== null) return obj.add(s.offset).readPointer();
    const v = new Il2Cpp.Object(obj).method<any>(s.getter!, 0).invoke();
    return v === null ? NULL : (v as Il2Cpp.Object).handle;
}

function setRef(obj: NativePointer, s: Slot, value: NativePointer): void {
    if (s.offset !== null) wbarrier(obj, obj.add(s.offset), value);
    else new Il2Cpp.Object(obj).method(s.setter!, 1).invoke(new Il2Cpp.String(value));
}

function readId(obj: NativePointer, s: Slot): string {
    if (s.offset === null) return String(new Il2Cpp.Object(obj).method<any>(s.getter!, 0).invoke());
    const at = obj.add(s.offset);
    switch (s.type.name) {
        case "System.Int64": return at.readS64().toString();
        case "System.UInt64": return at.readU64().toString();
        case "System.Int32": return String(at.readS32());
        case "System.UInt32": return String(at.readU32());
        default: return String(at.readS64());
    }
}

class Field {
    elementSlots: Slot[] = [];
    enumValues: number[] = [];

    constructor(readonly name: string, readonly s: Slot, readonly byJp: Map | undefined, readonly shape: Shape) { }

    static for(entity: Il2Cpp.Class, name: string, byJp: Map | undefined): Field | null {
        const shape: Shape = name.endsWith("[]") ? "list" : name.endsWith("{}") ? "dict" : "plain";
        const s = slot(entity, shape === "plain" ? name : name.slice(0, -2));
        if (s === null) return null;
        const field = new Field(name, s, byJp, shape);
        const typeName = s.type.name;
        if (shape === "plain") return typeName === "System.String" ? field : null;
        if (shape === "list") {
            if (typeName === "System.String[]") return field;
            if (!typeName.endsWith("[]")) return null;
            const element = s.type.class.elementClass;
            if (!element) return null;
            for (const f of element.fields)
                if (!f.isStatic && f.type.name === "System.String") field.elementSlots.push({ offset: f.offset, type: f.type });
            return field.elementSlots.length > 0 ? field : null;
        }
        const generics = s.type.class.generics;
        if (generics.length !== 2 || !generics[0].isEnum || generics[1].type.name !== "System.String") return null;
        field.enumValues = generics[0].fields.filter(f => f.isStatic && f.isLiteral).map(f => Number(f.value));
        return field;
    }

    private lookup(jp: string | null): string | null {
        if (!jp || !this.byJp) return null;
        const en = this.byJp[jp];
        return en !== undefined && en !== jp ? en : null;
    }

    /** Swaps this field's text on one row object; returns how many strings. */
    swap(obj: NativePointer, rows: Map, row: string | null): number {
        if (this.shape === "plain") {
            const jp = readString(getRef(obj, this.s));
            if (!jp) return 0;
            let en: string | undefined = row !== null ? rows[row + this.name] : undefined;
            if (en === undefined && this.byJp) en = this.byJp[jp];
            if (en === undefined || en === jp) return 0;
            setRef(obj, this.s, newString(en));
            return 1;
        }
        if (!this.byJp) return 0;
        const value = getRef(obj, this.s);
        if (value.isNull()) return 0;
        let swapped = 0;
        if (this.shape === "list") {
            const n = value.add(ARRAY_LENGTH).readU64().toNumber();
            for (let i = 0; i < n; i++) {
                const at = value.add(ARRAY_DATA + i * Process.pointerSize);
                const element = at.readPointer();
                if (element.isNull()) continue;
                if (this.elementSlots.length === 0) {
                    const en = this.lookup(readString(element));
                    if (en !== null) {
                        wbarrier(value, at, newString(en));
                        swapped++;
                    }
                    continue;
                }
                for (const s of this.elementSlots) {
                    const en = this.lookup(readString(getRef(element, s)));
                    if (en !== null) {
                        setRef(element, s, newString(en));
                        swapped++;
                    }
                }
            }
            return swapped;
        }
        const dict = new Il2Cpp.Object(value);
        for (const key of this.enumValues) {
            if (!dict.method<boolean>("ContainsKey", 1).invoke(key as any)) continue;
            const v = dict.method<Il2Cpp.String>("get_Item", 1).invoke(key as any);
            const en = this.lookup(v.isNull() ? null : v.content);
            if (en !== null) {
                dict.method("set_Item", 2).invoke(key as any, Il2Cpp.string(en));
                swapped++;
            }
        }
        return swapped;
    }
}

/** Native get_Count / get_Item(int) of a table class, resolved once. */
interface Rows { count: (t: NativePointer) => number, item: (t: NativePointer, i: number) => NativePointer }
const rowsByClass = new globalThis.Map<string, Rows>();

function rowsOf(table: Il2Cpp.Object): Rows {
    const key = table.class.handle.toString();
    let rows = rowsByClass.get(key);
    if (rows) return rows;
    const count = table.method("get_Count", 0);
    const item = table.method("get_Item", 1).overload("System.Int32");
    const countFn = new NativeFunction(count.virtualAddress, "int", ["pointer", "pointer"]);
    const itemFn = new NativeFunction(item.virtualAddress, "pointer", ["pointer", "int", "pointer"]);
    const countInfo = count.handle, itemInfo = item.handle;
    rows = {
        count: t => countFn(t, countInfo) as number,
        item: (t, i) => itemFn(t, i, itemInfo) as NativePointer,
    };
    rowsByClass.set(key, rows);
    return rows;
}

class Table {
    seen = "";

    constructor(readonly name: string, readonly getter: Il2Cpp.Method, readonly fields: Field[], readonly id: Slot | null) { }

    fetch(db: Il2Cpp.Object): Il2Cpp.Object | null {
        const t = db.method<Il2Cpp.Object>(this.getter.name, 0).invoke();
        return t.isNull() ? null : t;
    }

    state(table: Il2Cpp.Object, rows: Rows): string {
        const n = rows.count(table.handle);
        return n === 0 ? "" : `${table.handle}:${n}:${rows.item(table.handle, 0)}:${rows.item(table.handle, n - 1)}`;
    }
}

function memoryTableEntity(klass: Il2Cpp.Class): Il2Cpp.Class | null {
    for (let c: Il2Cpp.Class | null = klass; c !== null; c = c.parent)
        if (c.name.startsWith("MemoryTable") && c.generics.length === 1) return c.generics[0];
    return null;
}

function allTables(store: Store): Table[] {
    const wanted = new Set<string>([
        ...Object.keys(store.master).map(k => k.split(".")[0]),
        ...Object.keys(store.masterRows).map(k => k.split("/")[0]),
    ]);
    const db = cls("Api", "Assets.Api.MemoryDB.MemoryDB");
    const found: Table[] = [];
    for (const m of db.methods) {
        if (m.isStatic || !m.name.startsWith("get_") || m.parameterCount !== 0) continue;
        let entity: Il2Cpp.Class | null = null;
        try {
            entity = memoryTableEntity(m.returnType.class);
        } catch {
            continue;
        }
        if (entity === null || !wanted.has(entity.name)) continue;
        wanted.delete(entity.name);
        const name = entity.name;
        const names = new Set(Object.keys(store.master).filter(k => k.startsWith(name + ".")).map(k => k.substring(name.length + 1)));
        let hasRows = false;
        for (const k of Object.keys(store.masterRows))
            if (k.startsWith(name + "/")) {
                names.add(k.substring(k.lastIndexOf("/") + 1));
                hasRows = true;
            }
        const fields: Field[] = [];
        for (const fieldName of names) {
            const f = Field.for(entity, fieldName, store.master[`${name}.${fieldName}`]);
            if (f === null) log.warn(`Master text for ${name}.${fieldName}: no settable text of that shape, skipped.`);
            else fields.push(f);
        }
        if (fields.length > 0) found.push(new Table(name, m, fields, hasRows ? slot(entity, "Id") : null));
    }
    for (const missing of wanted) log.warn(`Master text for ${missing}: no such table on MemoryDB, skipped.`);
    return found;
}

let revision = -1;
let tables: Table[] = [];
// A pass in progress: which table, which row; stats for the log line.
let pass: { t: number, row: number, table: NativePointer | null, swapped: number, walked: number, started: number, work: number } | null = null;
let nextCheck = 0;

/** Called every frame; does at most BUDGET_MS of work. */
export function tick(): void {
    const now = Date.now();
    const store = ctx.store;
    if (pass === null) {
        if (now < nextCheck) return;
        nextCheck = now + CHECK_EVERY_MS;
        store.reloadIfChanged();
        if (revision !== store.revision) {
            revision = store.revision;
            tables = allTables(store);
            log.info(`Master text: ${tables.length} tables to watch.`);
        }
        if (tables.length === 0) return;
        pass = { t: 0, row: 0, table: null, swapped: 0, walked: 0, started: now, work: 0 };
    }
    const db = cls("Api", "Assets.Api.MemoryDB.MemoryDB").method<Il2Cpp.Object>("get_Instance").invoke();
    if (db.isNull()) {
        pass = null;
        return;
    }
    const deadline = now + BUDGET_MS;
    while (pass.t < tables.length) {
        const t = tables[pass.t];
        try {
            const table = t.fetch(db);
            if (table === null) {
                pass.t++;
                continue;
            }
            const rows = rowsOf(table);
            if (pass.table === null || !pass.table.equals(table.handle)) {
                // starting this table (or it was replaced mid-walk): walk only if it changed
                const state = t.state(table, rows);
                if (state === "" || state === t.seen) {
                    pass.t++;
                    pass.table = null;
                    continue;
                }
                t.seen = state;
                pass.table = table.handle;
                pass.row = 0;
                pass.walked++;
            }
            const n = rows.count(table.handle);
            while (pass.row < n) {
                const obj = rows.item(table.handle, pass.row++);
                if (obj.isNull()) continue;
                const row = t.id !== null ? `${t.name}/${readId(obj, t.id)}/` : null;
                for (const f of t.fields) pass.swapped += f.swap(obj, store.masterRows, row);
                if ((pass.row & 31) === 0 && Date.now() >= deadline) {
                    pass.work += Date.now() - now;
                    return;
                }
            }
        } catch (e) {
            log.errorOf(`master ${t.name}`, e);
        }
        pass.t++;
        pass.table = null;
    }
    pass.work += Date.now() - now;
    if (pass.swapped > 0)
        log.info(`Master text: ${pass.swapped} strings swapped in ${pass.walked} table(s), ` +
            `${pass.work} ms of work over ${Date.now() - pass.started} ms.`);
    pass = null;
}
