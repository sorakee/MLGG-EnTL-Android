// Port of TranslationStore.cs and PackInfo: Japanese -> English from every *.json pack in a folder.
// Full packs load in name order (later wins), then each channel's update packs in sequence (only those made
// for the installed base), then headerless packs (a player's own, "zz_mine.json"). Reloads when files change.
import * as fs from "./fs.js";
import * as log from "./log.js";

const SUPPORTED_FORMAT = 2;  // 2: update packs (null entries remove)
const RELOAD_CHECK_MS = 1000;
export const LEGACY_BASE = "translations.json";

export type Map = { [jp: string]: string };

export class PackInfo {
    channel = "main";
    kind: string | null = null;
    id: string | null = null;
    base: string | null = null;
    seq = 0;

    constructor(readonly path: string) { }

    get name() { return this.path.substring(this.path.lastIndexOf("/") + 1); }
    get isUpdate() { return this.kind === "update"; }
    get isLegacyBase() { return this.kind === null && this.name.toLowerCase() === LEGACY_BASE; }
    get isOwn() { return this.kind === null && !this.isLegacyBase; }

    /** Reads only the start of the file: the header comes before the first section. */
    static read(path: string): PackInfo {
        const info = new PackInfo(path);
        try {
            let head = fs.readHead(path, 4096);
            const end = head.indexOf('"lines"');
            if (end >= 0) head = head.substring(0, end);
            for (const m of head.matchAll(/"(channel|kind|id|base)"\s*:\s*"([^"]*)"/g)) {
                switch (m[1]) {
                    case "channel": info.channel = m[2]; break;
                    case "kind": info.kind = m[2]; break;
                    case "id": info.id = m[2]; break;
                    case "base": info.base = m[2]; break;
                }
            }
            const seq = /"seq"\s*:\s*(\d+)/.exec(head);
            if (seq) info.seq = parseInt(seq[1], 10);
        } catch (e) {
            log.warn(`Couldn't read the header of ${info.name}: ${e}`);
        }
        return info;
    }
}

export class Store {
    lines: Map = {};
    names: Map = {};
    /** "Table.Field" -> Japanese -> English. */
    master: { [field: string]: Map } = {};
    /** "Table/Id/Field" -> English, checked before master. */
    masterRows: Map = {};
    ui: Map = {};
    uiFormats: Map = {};
    /** Goes up on every reload, so caches built from the maps know to rebuild. */
    revision = 0;

    private nextCheck = 0;
    private signature = "";

    constructor(readonly dir: string) { }

    name(jp: string | null): string | null {
        if (jp === null) return null;
        const en = this.names[jp];
        return en === undefined ? jp : en;
    }

    packFiles(): string[] {
        return fs.listFiles(this.dir).filter(n => n.toLowerCase().endsWith(".json"))
            .sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0)
            .map(n => `${this.dir}/${n}`);
    }

    /** Cheap enough per line: touches the disk once a second. */
    reloadIfChanged(): void {
        const now = Date.now();
        if (now < this.nextCheck) return;
        this.nextCheck = now + RELOAD_CHECK_MS;
        if (this.computeSignature() !== this.signature) this.reload();
    }

    reload(): void {
        fs.mkdirs(this.dir);
        const lines: Map = {}, names: Map = {}, masterRows: Map = {}, ui: Map = {}, uiFormats: Map = {};
        const master: { [field: string]: Map } = {};
        const started = Date.now();
        const order = this.loadOrder();
        for (const path of order) {
            try {
                const root = JSON.parse(File.readAllText(path));
                if (typeof root.format === "number" && root.format > SUPPORTED_FORMAT) {
                    log.warn(`${path.substring(path.lastIndexOf("/") + 1)} needs a newer patch, skipped.`);
                    continue;
                }
                merge(root.lines, lines);
                merge(root.names, names);
                merge(root.masterRows, masterRows);
                merge(root.ui, ui);
                merge(root.uiFormats, uiFormats);
                if (root.master)
                    for (const field of Object.keys(root.master)) merge(root.master[field], master[field] ??= {});
            } catch (e) {
                log.error(`Couldn't read ${path.substring(path.lastIndexOf("/") + 1)}: ${e}`);
            }
        }
        this.lines = lines;
        this.names = names;
        this.master = master;
        this.masterRows = masterRows;
        this.ui = ui;
        this.uiFormats = uiFormats;
        this.revision++;
        this.signature = this.computeSignature();
        let masterCount = Object.keys(masterRows).length;
        for (const f of Object.values(master)) masterCount += Object.keys(f).length;
        log.info(`Translations: ${Object.keys(lines).length} lines, ${Object.keys(names).length} names, ` +
            `${masterCount} master strings, ${Object.keys(ui).length + Object.keys(uiFormats).length} UI strings ` +
            `from ${order.length} pack(s) in ${Date.now() - started} ms.`);
    }

    /** Published and dev packs in name order, then each channel's updates for the installed base, then own packs. */
    private loadOrder(): string[] {
        const packs = this.packFiles().map(PackInfo.read);
        const full = packs.filter(p => !p.isUpdate && !p.isOwn);
        const bases = new Set(full.filter(p => p.id !== null).map(p => `${p.channel}\u0000${p.id}`));
        const order = full.map(p => p.path);
        const updates = packs.filter(p => p.isUpdate)
            .sort((a, b) => a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : a.seq - b.seq);
        for (const u of updates) {
            if (bases.has(`${u.channel}\u0000${u.base}`)) order.push(u.path);
            else log.warn(`${u.name} is for base ${u.channel} ${u.base}, which isn't installed; skipped.`);
        }
        for (const p of packs) if (p.isOwn) order.push(p.path);
        return order;
    }

    private computeSignature(): string {
        return this.packFiles().map(p => {
            const s = fs.statFile(p);
            return `${p}:${s?.size}:${s?.mtime}`;
        }).join("|");
    }
}

/** Adds a section's entries; null (in an update pack) removes one. */
function merge(section: any, into: Map): void {
    if (!section) return;
    for (const jp of Object.keys(section)) {
        const en = section[jp];
        if (en === null) delete into[jp];
        else if (typeof en === "string") into[jp] = en;
    }
}
