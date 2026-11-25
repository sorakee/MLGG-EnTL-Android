// Port of Reporter.cs ([Report]): helps the translators through the patch's report service (ReportUrl).
// ShareScenes: when the game downloads a story scene that is on the service's wanted list, its id and signed
// link go to the service, which downloads the scene itself. Nothing else about the player or account is sent.
// SendUntranslatedUi: rows of ui-untranslated.tsv (menu text only, already filtered) go in batches of 200;
// ui-untranslated.sent remembers which. The service's /v1/config can switch either off without a release.
import { ctx, DEFAULT_REPORT_URL, VERSION } from "./ctx.js";
import { cls, str, tryCls } from "./game.js";
import * as fs from "./fs.js";
import * as http from "./http.js";
import * as log from "./log.js";

const SCENE_URL = /^https:\/\/assets\.muvluv-girls-garden\.com\/production-private\/(?:ja\/)?master-data\/scenes\/(\d{8})\.bin\?[^#]*sig=/i;
const UI_BATCH = 200;
const UI_FIRST_MS = 30_000, UI_EVERY_MS = 120_000;

let baseUrl = "";
let sentPath = "";
let configState: "none" | "asked" | "read" | "failed" = "none";
let scenesOn = false, uiOn = false, uiBusy = false;
let wanted = new Set<string>();
let nextUi = 0;
const seenScenes = new Map<string, string>();  // id -> link, seen before the config came
const sentScenes = new Set<string>();
const sceneQueue: [string, string][] = [];  // filled from any thread (Best.HTTP), drained in tick
const uiQueue: [string, string][] = [];
let sentUi: Set<string> | null = null;

export function start(): void {
    const s = ctx.settings.Report;
    baseUrl = (s.ReportUrl.trim() || DEFAULT_REPORT_URL).replace(/\/+$/, "");
    sentPath = `${ctx.base}/ui-untranslated.sent`;
    if (s.ShareScenes) hookRequests();
    const parts = [s.ShareScenes ? "links to scenes the translators lack" : null,
        s.SendUntranslatedUi && s.LogUntranslatedUi ? "untranslated menu text" : null].filter(p => p !== null);
    if (parts.length > 0) log.info(`Reports on: ${parts.join(" and ")} go to the translators. Turn off under Report in config.json.`);
}

const enabled = () => ctx.settings.Report.ShareScenes || ctx.settings.Report.SendUntranslatedUi && ctx.settings.Report.LogUntranslatedUi;

/** Main thread, every frame. */
export function tick(): void {
    if (!enabled() || configState === "failed") return;
    if (configState === "none") {
        configState = "asked";
        http.request({ url: `${baseUrl}/v1/config`, timeout: 60 }, onConfig);
        return;
    }
    if (configState !== "read") return;
    while (sceneQueue.length > 0) {
        const [id, link] = sceneQueue.shift()!;
        scene(id, link);
    }
    if (uiOn && !uiBusy && Date.now() >= nextUi) {
        nextUi = Date.now() + UI_EVERY_MS;
        sendUi();
    }
}

function onConfig(r: http.Response): void {
    if (!r.ok) {
        configState = "failed";
        log.warn(`Report service unreachable (${r.error ?? r.code}); nothing is sent this session.`);
        return;
    }
    try {
        const root = JSON.parse(r.text ?? "{}");
        wanted = new Set(Array.isArray(root.wanted) ? root.wanted : []);
        scenesOn = ctx.settings.Report.ShareScenes && root.scenes === true;
        uiOn = ctx.settings.Report.SendUntranslatedUi && ctx.settings.Report.LogUntranslatedUi && root.ui === true;
        configState = "read";
        nextUi = Date.now() + UI_FIRST_MS;
        for (const [id, link] of seenScenes) scene(id, link);
        seenScenes.clear();
    } catch (e) {
        configState = "failed";
        log.warn(`Report service config unreadable: ${e}`);
    }
}

/** A scene link the game requested: send it if the translators want that scene. */
function scene(id: string, link: string): void {
    if (configState !== "read") {
        if (seenScenes.size < 50) seenScenes.set(id, link);
        return;
    }
    if (!scenesOn || !wanted.has(id) || sentScenes.has(id)) return;
    sentScenes.add(id);
    http.request({ url: `${baseUrl}/v1/scene`, post: JSON.stringify({ id, url: link }), timeout: 60 }, r => {
        if (r.ok) log.info(`Shared scene ${id} with the translators. Thank you!`);
        else log.warn(`Sharing scene ${id}: the report service said ${r.code} ${r.error ?? ""}`);
    });
}

/** A ui-untranslated.tsv row (escaped text, label path), new or kept from earlier: queued unless sent before. */
export function queueUi(escaped: string, path: string): void {
    if (!ctx.settings.Report.SendUntranslatedUi || sentPath === "") return;
    try {
        sentUi ??= new Set(fs.exists(sentPath) ? File.readAllText(sentPath).split(/\r?\n/).filter(l => l.length > 0) : []);
        if (!sentUi.has(escaped)) uiQueue.push([escaped, path]);
    } catch (e) {
        log.warn(`ui-untranslated.sent: ${e}`);
    }
}

/** Forget sent rows that are no longer in the log (translated by now). */
export function keepSent(logged: Set<string>): void {
    try {
        if (sentPath === "" || !fs.exists(sentPath)) return;
        const sent = File.readAllText(sentPath).split(/\r?\n/).filter(l => l.length > 0);
        const keep = sent.filter(l => logged.has(l));
        if (keep.length < sent.length) File.writeAllText(sentPath, keep.map(l => l + "\n").join(""));
        sentUi = new Set(keep);
    } catch (e) {
        log.warn(`ui-untranslated.sent: ${e}`);
    }
}

function sendUi(): void {
    const rows = uiQueue.splice(0, UI_BATCH);
    if (rows.length === 0) return;
    uiBusy = true;
    http.request({ url: `${baseUrl}/v1/ui`, post: JSON.stringify({ plugin: `android-${VERSION}`, rows }), timeout: 60 }, r => {
        uiBusy = false;
        if (!r.ok) {
            if (r.code === 403) uiOn = false;  // switched off on the service
            uiQueue.unshift(...rows);
            log.warn(`Sending untranslated text failed: ${r.code} ${r.error ?? ""}`);
            return;
        }
        try {
            const f = new File(sentPath, "a");
            f.write(rows.map(row => row[0] + "\n").join(""));
            f.close();
            for (const row of rows) sentUi?.add(row[0]);
        } catch (e) {
            log.warn(`ui-untranslated.sent: ${e}`);
        }
    });
}

/** Watch the game's own Best.HTTP requests for scene links (any thread: only queue here). */
function hookRequests(): void {
    const manager = tryCls("com.Tivadar.Best.HTTP", "Best.HTTP.Shared.HTTPManager");
    const send = manager?.tryMethod("SendRequest", 1);
    if (!send) {
        log.warn("Scene sharing: HTTPManager.SendRequest not found; off.");
        return;
    }
    send.implementation = function (this: any, request: any) {
        try {
            const req = request as Il2Cpp.Object;
            if (!req.isNull()) {
                let uri = req.method<Il2Cpp.Object>("get_CurrentUri").invoke();
                if (uri.isNull()) uri = req.method<Il2Cpp.Object>("get_Uri").invoke();
                const url = uri.isNull() ? null : str(uri.method("get_AbsoluteUri").invoke());
                const m = url ? SCENE_URL.exec(url) : null;
                if (m) sceneQueue.push([m[1], url!]);
            }
        } catch (e) {
            log.errorOf("scene link", e);
        }
        return this.method("SendRequest", 1).invoke(request);
    };
}
