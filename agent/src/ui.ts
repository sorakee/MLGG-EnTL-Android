// Port of UiText.cs: fixed UI labels and text built from the game's format strings. Lookup order on the
// text with \r\n and literal \n made plain newlines (the PC file's summary has the details):
//   1. whole text in "ui" (also by inner text), else a name or any master text;  2. marquee X<space=…>X;
//   3. inner text between leading/trailing tags and spaces, re-wrapped;  4. "uiFormats" patterns, Japanese
//   captures resolved by these same steps (depth 2);  5. per piece between tags and line breaks;
//   6. typewriter labels (TextViewText, Maze navigator): a prefix of a known text shows that share of English.
// translate/work/ui_resolve_check.py mirrors this chain; keep the format ranking identical (regex length).
import { ctx } from "./ctx.js";
import { cls, hasComponent, nameOf, parentOf, pathOf, str, tryCls } from "./game.js";
import * as fs from "./fs.js";
import * as log from "./log.js";
import type { Map, Store } from "./store.js";
import * as reporter from "./reporter.js";

const CACHE_LIMIT = 8192;
const MAX_DEPTH = 2;
const TYPEWRITER = "TextViewText";
const NO_WRAP = 0, NORMAL_WRAP = 1;  // TMPro.TextWrappingModes

const cache = new Map<string, string | null>();
const fitted = new Set<string>();
let revision = -1;
let exact = new Map<string, string>();
let masterEnglish = new Set<string>();
let typed: string[] = [];
let typedFormats: string[] = [];
let formatEn = new Map<string, string>();
let formats: Format[] = [];

const MARQUEE = /^(.+?)(<space=[^>]+>)\1(?=\n?$)/s;
const EDGES = /^((?:<[^>]+>|\s)*)(.*?)((?:<[^>]+>|\s)*)(?=\n?$)/s;
const PIECES = /(<[^>]+>|\n)/;
const PLACEHOLDER = /\{(\d+)(?::[^}]*)?\}/g;
const SWEEP = /<color=[^>]*><\/color>|<\/color><color=[^>]*>/g;
const TAGS = /(<[^>]+>)/;
const DIGITS = /[0-9０-９]+/g;  // .NET's \d; this V8 has no \p{} tables (ASCII and full-width digits)

interface Format { pattern: RegExp, rank: number, anchor: string, en: string }

let contentSizeFitter: Il2Cpp.Class | null = null;
let textMarquee: Il2Cpp.Class | null = null;

export function hasJapanese(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0x3040 && c <= 0x30ff || c >= 0x3400 && c <= 0x9fff || c >= 0xff01 && c <= 0xff60) return true;
    }
    return false;
}

/** Kana or kanji: text that needs translating, unlike full-width digits and symbols. */
function hasWords(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0x3040 && c <= 0x30ff || c >= 0x3400 && c <= 0x9fff) return true;
    }
    return false;
}

const normalize = (s: string) =>
    s.indexOf("\r") >= 0 || s.indexOf("\\n") >= 0
        ? s.split("\r\n").join("\n").split("\\r\\n").join("\n").split("\\n").join("\n") : s;

const edges = (s: string) => EDGES.exec(s)!;

/** English for a label's text, or the same string if there's none. label may be null. */
export function translate(jp: string | null, label: Il2Cpp.Object | null): string | null {
    if (!jp) return jp;
    const store = ctx.store;
    if (!hasJapanese(jp) && jp.indexOf("「") < 0) {
        // Master text is swapped in the tables, so its label is set to English already: fit it all the same.
        if (label !== null && ctx.settings.Text.FitUiLabels && !isTypewriter(label)) {
            if (revision !== store.revision) rebuild(store);
            if (masterEnglish.has(jp) || jp.indexOf("<") >= 0 && masterEnglish.has(edges(jp)[2])) fit(label, jp);
        }
        return jp;
    }
    if (label !== null && keepJapanese(label)) return jp;
    if (revision !== store.revision) rebuild(store);
    let en: string | null | undefined;
    if (label !== null && isTypewriter(label)) {
        const s = normalize(jp).replace(SWEEP, "");  // new text every frame while typing: not cached
        en = (isNavigator(label) ? exactOf(s, store) : null) ?? typedPrefix(s) ?? resolve(s, store, 0, false);
    } else {
        en = cache.get(jp);
        if (en === undefined) {
            en = resolve(normalize(jp), store, 0, true);
            if (cache.size >= CACHE_LIMIT) cache.clear();
            cache.set(jp, en);
        }
    }
    if (en === null) {
        if (ctx.settings.Report.LogUntranslatedUi) logMiss(jp, label);
        return jp;
    }
    if (ctx.settings.Text.FitUiLabels && label !== null) {
        if (isNavigator(label)) wrap(label);
        else if (!isTypewriter(label)) fit(label, en);
    }
    return en;
}

const isTypewriter = (label: Il2Cpp.Object) => nameOf(label) === TYPEWRITER || isNavigator(label);

/** The Maze craft navigator's speech (Navigator/Back/Text (TMP)): a typewriter. */
function isNavigator(label: Il2Cpp.Object): boolean {
    const back = parentOf(label);
    if (back === null || nameOf(back) !== "Back") return false;
    const nav = parentOf(back);
    return nav !== null && nameOf(nav) === "Navigator";
}

/** Memory skill kind chips (攻撃 補助 回復 妨害 in one label) stay Japanese. */
function keepJapanese(label: Il2Cpp.Object): boolean {
    const parent = parentOf(label);
    return parent !== null && nameOf(parent) === "SkillKind";
}

function rebuild(store: Store): void {
    revision = store.revision;
    cache.clear();
    const map = new Map<string, string>();
    for (const [jp, en] of Object.entries(store.ui)) map.set(normalize(jp), normalize(en));
    for (const [jp, en] of Array.from(map.entries())) {
        const inner = edges(jp)[2];
        if (inner.length < jp.length && hasJapanese(inner) && !map.has(inner)) map.set(inner, edges(en)[2]);
    }
    typed = Array.from(map.keys()).filter(k => k.length >= 8).sort(ordinal);
    const fmts = new Map<string, string>();
    for (const [jp, en] of Object.entries(store.uiFormats)) {
        const k = normalize(jp);
        if (!fmts.has(k)) fmts.set(k, normalize(en));
    }
    formatEn = fmts;
    typedFormats = Array.from(fmts.keys()).filter(k => k.length >= 8).sort(ordinal);
    const english = new Set<string>();
    for (const field of Object.values(store.master))
        for (const [jp, en] of Object.entries(field as Map)) {
            const k = normalize(jp);
            if (!map.has(k)) map.set(k, normalize(en));
            english.add(en);
        }
    for (const en of Object.values(store.masterRows)) english.add(en);
    exact = map;
    masterEnglish = english;

    const list: Format[] = [];
    for (const [jp, en] of Object.entries(store.uiFormats)) {
        try {
            list.push(compile(normalize(jp), normalize(en)));
        } catch (e) {
            log.warn(`UI format ${jp}: ${e}`);
        }
    }
    // Most literal text first, so 「{0}日{1}時間」 wins over 「{0}時間」 (ranked by the .NET regex's length, as on PC).
    formats = list.sort((a, b) => b.rank - a.rank);
    if (logged === null && ctx.settings.Report.LogUntranslatedUi) {
        try {
            openLog();
        } catch (e) {
            log.errorOf("ui log", e);
            logFile = null;
        }
    }
}

const ordinal = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function exactOf(s: string, store: Store): string | null {
    const en = exact.get(s) ?? store.names[s];
    return en === undefined ? null : en;
}

function resolve(s: string, store: Store, depth: number, split: boolean): string | null {
    let en = exactOf(s, store);
    if (en !== null) return en;

    const marquee = MARQUEE.exec(s);
    if (marquee) {
        const half = resolve(marquee[1], store, depth, split);
        return half === null ? null : half + marquee[2] + half;
    }

    const e = edges(s);
    const inner = e[2];
    if (inner.length > 0 && inner.length < s.length) {
        en = exactOf(inner, store) ?? match(inner, store, depth);
        if (en !== null) return e[1] + en + e[3];
    }

    en = match(s, store, depth);
    if (en !== null || depth > 0 || !split) return en;
    return splitPieces(s, store);
}

/** Each piece between tags and line breaks on its own; null if none translates. */
function splitPieces(s: string, store: Store): string | null {
    const parts = s.split(PIECES);
    if (parts.length < 2) return null;
    let any = false;
    for (let i = 0; i < parts.length; i++) {
        const piece = parts[i].trim();
        if (piece.length === 0 || !hasJapanese(piece) || piece[0] === "<") continue;
        const en = exactOf(piece, store) ?? match(piece, store, MAX_DEPTH - 1);
        if (en === null) continue;
        parts[i] = parts[i].replace(piece, () => en);
        any = true;
    }
    return any ? parts.join("") : null;
}

/** Typewriter labels show a growing prefix of their text: show the same share of the English. */
function typedPrefix(s: string): string | null {
    const e = edges(s);
    let shown = e[2].replace(/\\+$/, "");  // half of a literal \n
    if (shown.length === 0) return null;
    let en: string, full: string;
    const i = lowerBound(typed, shown);
    if (i < typed.length && typed[i].startsWith(shown)) {
        full = typed[i];
        en = exact.get(full)!;
    } else {
        const f = typedFormat(shown);
        if (f === null) return null;
        ({ shown, full, en } = f);
    }
    if (shown.length >= full.length) return e[1] + en;
    const n = Math.round(en.length * shown.length / full.length);
    let cut = en.substring(0, Math.min(n, en.length));
    const open = cut.lastIndexOf("<");
    if (open > cut.lastIndexOf(">")) cut = cut.substring(0, open);  // don't show half a tag
    return e[1] + cut;
}

function lowerBound(sorted: string[], key: string): number {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < key) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** A typed prefix of a "uiFormats" text: digit runs outside tags become {0}, {1}...; the format starting with
 *  that is the one being typed, and its English gets the numbers typed so far. */
function typedFormat(shownIn: string): { shown: string, full: string, en: string } | null {
    const values: string[] = [];
    let key = "";
    for (const part of shownIn.split(TAGS)) {
        if (part.startsWith("<")) {
            key += part;
            continue;
        }
        key += part.replace(DIGITS, d => {
            values.push(d);
            return `{${values.length - 1}}`;
        });
    }
    const i = lowerBound(typedFormats, key);
    if (i >= typedFormats.length || !typedFormats[i].startsWith(key)) return null;
    const full = typedFormats[i];
    const en = formatEn.get(full)!.replace(PLACEHOLDER, (_m, n) => {
        const k = parseInt(n, 10);
        return k < values.length ? values[k] : "";
    });
    return { shown: key, full, en };
}

/** Navigator speech wraps (its prefab doesn't) and keeps its size: auto-sizing would shrink it mid-line. */
function wrap(label: Il2Cpp.Object): void {
    const id = label.handle.toString();
    if (fitted.has(id)) return;
    fitted.add(id);
    label.method("set_textWrappingMode").invoke(NORMAL_WRAP as any);
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

/** Length of .NET's Regex.Escape(s), for ranking formats exactly as the PC plugin does. */
function netEscapedLength(s: string): number {
    let n = 0;
    for (const c of s) n += "\\*+?|{[()^$.# \t\n\r\f\v".includes(c) ? 2 : c.length;
    return n;
}

function compile(jp: string, en: string): Format {
    let pattern = "^", rank = 1, anchor = "", at = 0;
    const seen = new Set<string>();
    for (const m of jp.matchAll(PLACEHOLDER)) {
        const literal = jp.substring(at, m.index);
        if (literal.length > anchor.length) anchor = literal;
        pattern += reEscape(literal);
        rank += netEscapedLength(literal);
        const name = "p" + m[1];
        const group = seen.has(name) ? `\\k<${name}>` : `(?<${name}>.*?)`;
        seen.add(name);
        pattern += group;
        rank += group.length;
        at = m.index! + m[0].length;
    }
    const tail = jp.substring(at);
    if (tail.length > anchor.length) anchor = tail;
    pattern += reEscape(tail) + "(?=\\n?$)";
    rank += netEscapedLength(tail) + 1;
    return { pattern: new RegExp(pattern, "s"), rank, anchor, en };
}

function match(jp: string, store: Store, depth: number): string | null {
    for (const f of formats) {
        if (f.anchor.length > 0 && jp.indexOf(f.anchor) < 0) continue;
        const m = f.pattern.exec(jp);
        if (!m) continue;
        const en = fill(f.en, m, store, depth);
        if (en !== null) return en;
    }
    return null;
}

/** The English format with the captured values put in; null if a capture is Japanese with no English. */
function fill(format: string, m: RegExpExecArray, store: Store, depth: number): string | null {
    let out = "", at = 0;
    for (const p of format.matchAll(PLACEHOLDER)) {
        out += format.substring(at, p.index);
        at = p.index! + p[0].length;
        const g = m.groups?.["p" + p[1]];
        if (g === undefined) {
            out += p[0];
            continue;
        }
        let value: string | null = g;
        if (hasWords(value)) {  // full-width digits (「１つ」) pass through as they are
            value = depth < MAX_DEPTH ? resolve(value, store, depth + 1, true) : exactOf(value, store);
            if (value === null) return null;
        }
        out += value;
    }
    return out + format.substring(at);
}

/** Let a translated label shrink (down to 60%) rather than overflow; one-word labels stay on one line.
 *  Labels sized by a ContentSizeFitter and marquee labels are left alone. */
function fit(label: Il2Cpp.Object, en: string): void {
    const id = label.handle.toString();
    if (fitted.has(id)) return;
    fitted.add(id);
    if (label.method<boolean>("get_enableAutoSizing").invoke()) return;
    if (contentSizeFitter !== null && hasComponent(label, contentSizeFitter)) return;
    if (textMarquee !== null && hasComponent(label, textMarquee)) return;
    const size = label.method<number>("get_fontSize").invoke();
    label.method("set_fontSizeMax").invoke(size);
    label.method("set_fontSizeMin").invoke(Math.max(8, size * 0.6));
    label.method("set_enableAutoSizing").invoke(true);
    const plain = edges(en)[2];
    if (plain.indexOf(" ") < 0 && plain.indexOf("\n") < 0) label.method("set_textWrappingMode").invoke(NO_WRAP as any);
}

// ---- ui-untranslated.tsv ([Report] LogUntranslatedUi): menu text only, see loggable() and isPrivate().

const LOG_LIMIT = 1 << 20;
const LOG_MAX_TEXT = 2000;
const NOPARSE = /<noparse>.*?<\/noparse>/gs;
const PRIVATE_NAME_SCOPES = ["circle", "grandprix", "ranking", "opponent", "friend", "profile", "memberlist"];
let logged: Set<string> | null = null;
let logFile: File | null = null;
let logBytes = 0;

const logPath = () => `${ctx.base}/ui-untranslated.tsv`;
const escapeRow = (s: string) => s.replace(/\t/g, "\\t").replace(/\r/g, "").replace(/\n/g, "\\n");
const loggable = (jp: string) => jp.length <= LOG_MAX_TEXT && hasWords(jp.replace(NOPARSE, ""));
const utf8Length = (s: string) => unescape(encodeURIComponent(s)).length;

function isPrivate(text: string, path: string): boolean {
    if (path.includes("InputField") || path.includes("Chat") || path.includes("/News/")) return true;
    const leaf = path.substring(path.lastIndexOf("/") + 1);
    if (["UserNameText", "UserName", "FriendName", "PlayerName", "CircleName"].includes(leaf)) return true;
    if (leaf === "NameText" || leaf === "Name") {
        const scope = path.toLowerCase();
        if (PRIVATE_NAME_SCOPES.some(s => scope.includes(s))) return true;
    }
    return text.startsWith("VS ") && path.endsWith("TitleBack/Mask/Body");  // P-1 banner: 「VS <player>」
}

function logMiss(jp: string, label: Il2Cpp.Object | null): void {
    try {
        if (label !== null && nameOf(label) === TYPEWRITER || !loggable(jp)) return;
        if (logged === null) openLog();
        if (logFile === null || logBytes >= LOG_LIMIT) return;
        const escaped = escapeRow(jp);
        if (logged!.has(escaped)) return;
        logged!.add(escaped);
        const path = label === null ? "" : pathOf(label);
        if (isPrivate(escaped, path)) return;
        const row = `${escaped}\t${path}`;
        logFile.write(row + "\r\n");
        logFile.flush();
        logBytes += utf8Length(row) + 2;
        reporter.queueUi(escaped, path);
    } catch (e) {
        log.errorOf("ui log", e);
        logFile = null;
    }
}

/** Reads the log, keeps rows that are still misses (today's filters and pack), rewrites it, opens it for appending. */
function openLog(): void {
    logged = new Set();
    const path = logPath();
    const keep: string[] = [];
    let dropped = 0;
    if (fs.exists(path)) {
        for (const line of File.readAllText(path).split(/\r?\n/)) {
            if (line.length === 0) continue;
            const tab = line.indexOf("\t");
            const text = tab < 0 ? line : line.substring(0, tab);
            const where = tab < 0 ? "" : line.substring(tab + 1);
            if (!logged.has(text) && stillMissing(text, where)) keep.push(line);
            else dropped++;
            logged.add(text);
        }
    }
    if (dropped > 0) {
        File.writeAllText(path + ".tmp", keep.map(l => l + "\r\n").join(""));
        fs.move(path + ".tmp", path);
        log.info(`ui-untranslated.tsv: ${keep.length} rows kept, ${dropped} dropped.`);
    }
    logBytes = keep.reduce((n, l) => n + utf8Length(l) + 2, 0);
    logFile = new File(path, "a");
    reporter.keepSent(new Set(keep.map(l => l.split("\t")[0])));
    for (const l of keep) {
        const tab = l.indexOf("\t");
        reporter.queueUi(tab < 0 ? l : l.substring(0, tab), tab < 0 ? "" : l.substring(tab + 1));
    }
}

function stillMissing(escaped: string, where: string): boolean {
    const jp = escaped.replace(/\\t/g, "\t");
    if (where.endsWith("/" + TYPEWRITER) || !loggable(jp) || isPrivate(escaped, where)) return false;
    let s = normalize(jp);
    if (where.includes("Navigator/Back/")) {
        s = s.replace(SWEEP, "");
        return (exactOf(s, ctx.store) ?? typedPrefix(s) ?? resolve(s, ctx.store, 0, false)) === null;
    }
    return resolve(s, ctx.store, 0, true) === null;
}

// ---- hooks

export function install(): void {
    contentSizeFitter = tryCls("UnityEngine.UI", "UnityEngine.UI.ContentSizeFitter");
    textMarquee = tryCls("Utilities", "Assets.Utilities.TextMarquee");
    const tmp = cls("Unity.TextMeshPro", "TMPro.TMP_Text");

    const swap = (self: Il2Cpp.Object, value: any): any => {
        try {
            const jp = str(value);
            const en = translate(jp, self);
            if (en !== jp && en !== null) return Il2Cpp.string(en);
        } catch (e) {
            log.errorOf("ui", e);
        }
        return value;
    };

    tmp.method("set_text").implementation = function (this: any, value: any) {
        return this.method("set_text").invoke(swap(this, value));
    };
    // SetText(string) and SetText(string, bool) share one native body: patch only one of them.
    tmp.method("SetText", 1).overload("System.String").implementation = function (this: any, value: any) {
        return this.method("SetText", 1).overload("System.String").invoke(swap(this, value));
    };
    // Prefab text is deserialized into the label, not set: check it when the label turns on.
    const ugui = cls("Unity.TextMeshPro", "TMPro.TextMeshProUGUI");
    ugui.method("OnEnable").implementation = function (this: any) {
        this.method("OnEnable").invoke();
        try {
            const jp = str(this.method("get_text").invoke());
            const en = translate(jp, this);
            if (en !== jp && en !== null) this.method("set_text").invoke(Il2Cpp.string(en));
        } catch (e) {
            log.errorOf("ui enable", e);
        }
    };
    log.info("UI hooks installed.");
}
