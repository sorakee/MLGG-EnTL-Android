// Shortcuts into the game's il2cpp classes, and a main-thread tick (BepInEx gave the PC plugin
// MonoBehaviour.Update; here EventSystem.Update, which runs every frame while any UI is up).
import "frida-il2cpp-bridge";
import * as log from "./log.js";

export function cls(assembly: string, name: string): Il2Cpp.Class {
    return Il2Cpp.domain.assembly(assembly).image.class(name);
}

export function tryCls(assembly: string, name: string): Il2Cpp.Class | null {
    return Il2Cpp.domain.tryAssembly(assembly)?.image.tryClass(name) ?? null;
}

/** The C# string's text, or null for a null reference. */
export function str(value: any): string | null {
    const s = value as Il2Cpp.String;
    return s === null || s === undefined || s.isNull() ? null : s.content;
}

type Job = { every: number, next: number, run: () => void, name: string };
const jobs: Job[] = [];

/** Runs fn on the game's main thread about every `seconds` (0 = every frame). A failing job pauses 30 s. */
export function every(seconds: number, name: string, fn: () => void): void {
    jobs.push({ every: seconds * 1000, next: 0, run: fn, name });
}

export function startTicking(): void {
    const update = cls("UnityEngine.UI", "UnityEngine.EventSystems.EventSystem").method("Update");
    let lastFrame = 0;
    update.implementation = function (this: any) {
        this.method("Update").invoke();
        const now = Date.now();
        if (now === lastFrame) return;  // two EventSystems: once per frame is enough
        lastFrame = now;
        for (const job of jobs) {
            if (now < job.next) continue;
            job.next = now + job.every;
            try {
                job.run();
            } catch (e) {
                log.errorOf(job.name, e);
                job.next = now + 30000;
            }
        }
    };
}

/** A transform's name path from the root (at most 12 levels), as in ui-untranslated.tsv. */
export function pathOf(component: Il2Cpp.Object): string {
    const names: string[] = [];
    let t: Il2Cpp.Object | null = component.method<Il2Cpp.Object>("get_transform").invoke();
    while (t !== null && !t.isNull() && names.length < 12) {
        names.push(str(t.method<Il2Cpp.String>("get_name").invoke()) ?? "");
        t = t.method<Il2Cpp.Object>("get_parent").invoke();
    }
    return names.reverse().join("/");
}

export function nameOf(obj: Il2Cpp.Object): string {
    return str(obj.method<Il2Cpp.String>("get_name").invoke()) ?? "";
}

export function parentOf(component: Il2Cpp.Object): Il2Cpp.Object | null {
    const t = component.method<Il2Cpp.Object>("get_transform").invoke();
    const p = t.method<Il2Cpp.Object>("get_parent").invoke();
    return p.isNull() ? null : p;
}

/** A non-generic method of klass (or a parent) whose parameter types are exactly `types`, or null. */
export function findMethod<T extends Il2Cpp.Method.ReturnType>(klass: Il2Cpp.Class, name: string, types: string[]): Il2Cpp.Method<T> | null {
    for (let c: Il2Cpp.Class | null = klass; c !== null; c = c.parent)
        for (const m of c.methods)
            if (m.name === name && !m.isGeneric && m.parameterCount === types.length &&
                m.parameters.every((p, i) => p.type.name === types[i])) return m as Il2Cpp.Method<T>;
    return null;
}

const componentMethods = new Map<string, Il2Cpp.Method<any>>();

/** A UnityEngine.Component method by parameter types (the bridge's overload() missed these). Use with bound(). */
export function componentMethod<T extends Il2Cpp.Method.ReturnType>(name: string, ...types: string[]): Il2Cpp.Method<T> {
    const key = `${name}(${types.join(",")})`;
    let m = componentMethods.get(key);
    if (!m) {
        const component = cls("UnityEngine.CoreModule", "UnityEngine.Component");
        m = findMethod(component, name, types) ?? undefined;
        if (!m) {
            const seen = component.methods.filter(x => x.name === name)
                .map(x => `(${x.parameters.map(p => p.type.name).join(", ")})${x.isGeneric ? " generic" : ""}`);
            throw new Error(`Component.${key} not found; there is: ${seen.join(" | ")}`);
        }
        componentMethods.set(key, m);
    }
    return m as Il2Cpp.Method<T>;
}

/** method bound to obj (Method.bind exists at runtime; the bridge's typings leave it out). */
export function bound<T extends Il2Cpp.Method.ReturnType>(method: Il2Cpp.Method<T>, obj: Il2Cpp.Object): Il2Cpp.Method<T> {
    return (method as any).bind(obj);
}

/** component.GetComponent(type) is not null. */
export function hasComponent(component: Il2Cpp.Object, type: Il2Cpp.Class): boolean {
    return !bound(componentMethod<Il2Cpp.Object>("GetComponent", "System.Type"), component).invoke(type.type.object).isNull();
}
