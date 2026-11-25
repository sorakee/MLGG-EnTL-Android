// Port of TextFit.cs: once a second, labels on screens sized for Japanese (episode lists, chapter buttons)
// get auto-sizing from their own size down to 60%; trophy badges stay on one line, down to 40%.
import { bound, cls, componentMethod, findMethod, hasComponent, tryCls } from "./game.js";

const MIN_SCALE = 0.6;
const BADGE_MIN_SCALE = 0.4;
const NO_WRAP = 0;

const fitted = new Set<string>();
let screens: Il2Cpp.Class[] = [];
let badge: Il2Cpp.Class | null = null;
let label: Il2Cpp.Class;
let marquee: Il2Cpp.Class | null = null;
let objectClass: Il2Cpp.Class;

export function install(): void {
    screens = [
        tryCls("GameUi", "Assets.GameUi.Episode.EpisodeComponent"),
        tryCls("GameUi", "Assets.GameUi.Episode.MainChapter.MainChapterComponent"),
        tryCls("GameUi", "Assets.GameUi.Episode.EventChapter.EventChapterComponent"),
    ].filter((c): c is Il2Cpp.Class => c !== null);
    badge = tryCls("GameUi", "Assets.GameUi.Trophy.TrophyComponent");
    label = cls("Unity.TextMeshPro", "TMPro.TextMeshProUGUI");
    marquee = tryCls("Utilities", "Assets.Utilities.TextMarquee");
    objectClass = cls("UnityEngine.CoreModule", "UnityEngine.Object");
    // Resolved now, so a missing method shows in the log at launch rather than on the first episode screen.
    // The build strips unused non-generic overloads: Component.GetComponentsInChildren(Type, bool) is gone, so
    // use the generic one inflated for TextMeshProUGUI, as the PC plugin does.
    const generic = cls("UnityEngine.CoreModule", "UnityEngine.Component").methods
        .find(m => m.name === "GetComponentsInChildren" && m.isGeneric && m.parameterCount === 1 &&
            m.parameters[0].type.name === "System.Boolean");
    if (!generic) throw new Error("Component.GetComponentsInChildren<T>(bool) not found");
    getLabels = generic.inflate<Il2Cpp.Array<Il2Cpp.Object>>(label);
    findObjects = findMethod(objectClass, "FindObjectsByType", ["System.Type", "UnityEngine.FindObjectsSortMode"]);
    findObjectsOld = findObjects ? null : findMethod(objectClass, "FindObjectsOfType", ["System.Type"]);
    if (!findObjects && !findObjectsOld) throw new Error("no FindObjectsByType(Type, FindObjectsSortMode) or FindObjectsOfType(Type)");
    componentMethod("GetComponent", "System.Type");
}

let getLabels: Il2Cpp.Method<Il2Cpp.Array<Il2Cpp.Object>>;
let findObjects: Il2Cpp.Method<Il2Cpp.Array<Il2Cpp.Object>> | null = null;
let findObjectsOld: Il2Cpp.Method<Il2Cpp.Array<Il2Cpp.Object>> | null = null;

function find(type: Il2Cpp.Class): Il2Cpp.Object[] {
    const found = findObjects ? findObjects.invoke(type.type.object, 0 as any) : findObjectsOld!.invoke(type.type.object);
    const out: Il2Cpp.Object[] = [];
    for (let i = 0; i < found.length; i++) out.push(found.get(i));
    return out;
}

function labelsIn(component: Il2Cpp.Object): Il2Cpp.Object[] {
    const arr = bound(getLabels, component).invoke(true);
    const out: Il2Cpp.Object[] = [];
    for (let i = 0; i < arr.length; i++) out.push(arr.get(i));
    return out;
}

const hasMarquee = (l: Il2Cpp.Object) => marquee !== null && hasComponent(l, marquee);

export function tick(): void {
    for (const type of screens)
        for (const screen of find(type))
            for (const l of labelsIn(screen)) {
                const id = l.handle.toString();
                if (fitted.has(id)) continue;
                fitted.add(id);
                if (l.method<boolean>("get_enableAutoSizing").invoke() || hasMarquee(l)) continue;
                const size = l.method<number>("get_fontSize").invoke();
                l.method("set_fontSizeMax").invoke(size);
                l.method("set_fontSizeMin").invoke(Math.max(8, size * MIN_SCALE));
                l.method("set_enableAutoSizing").invoke(true);
            }
    if (badge === null) return;
    for (const b of find(badge))
        for (const l of labelsIn(b)) {
            const id = l.handle.toString();
            if (fitted.has(id)) continue;
            fitted.add(id);
            const size = l.method<boolean>("get_enableAutoSizing").invoke()
                ? l.method<number>("get_fontSizeMax").invoke() : l.method<number>("get_fontSize").invoke();
            l.method("set_fontSizeMax").invoke(size);
            l.method("set_fontSizeMin").invoke(Math.max(8, size * BADGE_MIN_SCALE));
            l.method("set_enableAutoSizing").invoke(true);
            l.method("set_textWrappingMode").invoke(NO_WRAP as any);
        }
}
