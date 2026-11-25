// Port of Updater.cs: on launch, read each channel's manifest (pack/publish.py) and bring translations/ up to
// date: the base pack when the manifest names another one, then the update packs not here yet; updates the
// manifest no longer lists are deleted. Files are checked against the manifest's SHA-256 (of the uncompressed
// JSON; a .gz url is gunzipped) and written under a temporary name first; the store reloads them by itself.
// A channel whose local base is a dev pack is left alone. Only the manifest and pack URLs are contacted.
// Requests go through the game's UnityWebRequest, stepped from the main-thread tick (a generator per job).
import { gunzipSync } from "fflate/browser";  // the Node build needs Node's module API
import { ctx, VERSION } from "./ctx.js";
import * as fs from "./fs.js";
import * as http from "./http.js";
import type { Request, Response } from "./http.js";
import * as log from "./log.js";
import { PackInfo } from "./store.js";

type Job = Generator<Request, void, Response>;

let job: Job | null = null;
let noticeShown = false;

/** Queues the update (http.ts sends it from the first frame on). */
export function start(manifestUrls: string[]): void {
    job = run([...new Set(manifestUrls.map(u => u.trim()).filter(u => u.length > 0))]);
    advance(undefined as any);
}

/** Deletes a channel's downloaded packs (base and updates; not dev or player packs). */
export function removeChannel(channel: string): void {
    for (const p of ctx.store.packFiles().map(PackInfo.read))
        if (p.channel === channel && (p.kind === "base" || p.isUpdate)) {
            fs.remove(p.path);
            log.info(`Translations (${channel}): removed ${p.name}.`);
        }
}

function advance(response: Response): void {
    if (job === null) return;
    let next: IteratorResult<Request, void>;
    try {
        next = job.next(response);
    } catch (e) {
        log.errorOf("updater", e);
        job = null;
        return;
    }
    if (next.done) {
        job = null;
        return;
    }
    http.request(next.value as Request, advance);
}

function* run(urls: string[]): Job {
    for (const url of urls) {
        try {
            yield* update(url);
        } catch (e) {
            log.warn(`Translation update from ${url} failed: ${e}`);
        }
    }
}

function* get(url: string, binary: boolean): Generator<Request, Response, Response> {
    const r = yield { url, binary };
    if (!r.ok) throw new Error(`${url}: HTTP ${r.code} ${r.error ?? ""}`.trim());
    return r;
}

function* update(url: string): Generator<Request, void, Response> {
    const root = JSON.parse((yield* get(url, false)).text ?? "");
    const channel: string = root.channel;
    const dir = ctx.store.dir;
    fs.mkdirs(dir);
    const local = ctx.store.packFiles().map(PackInfo.read).filter(p => p.channel === channel);
    const localBase = local.find(p => !p.isUpdate && !p.isOwn);
    if (localBase?.kind === "dev") {
        log.info(`Translations (${channel}): local dev pack, not updating.`);
        return;
    }
    const changed: string[] = [];
    const baseId: string = root.base.id;
    const baseFile = safeName(root.base.file);
    if (!localBase || localBase.id !== baseId) {
        yield* download(root.base, `${dir}/${baseFile}`);
        if (localBase && localBase.name.toLowerCase() !== baseFile.toLowerCase()) fs.remove(localBase.path);
        changed.push(`base ${baseId}`);
    }
    const wanted = new Set<string>();
    for (const u of root.updates ?? []) {
        const file = safeName(u.file);
        wanted.add(file.toLowerCase());
        const have = local.find(p => p.isUpdate && p.id === u.id && p.base === baseId);
        if (have && have.name.toLowerCase() === file.toLowerCase()) continue;
        yield* download(u, `${dir}/${file}`);
        changed.push(`update ${u.id}`);
    }
    for (const stale of local) if (stale.isUpdate && !wanted.has(stale.name.toLowerCase())) fs.remove(stale.path);
    log.info(changed.length === 0
        ? `Translations (${channel}): up to date (base ${baseId}).`
        : `Translations (${channel}): installed ${changed.join(", ")}. Menus and game data text fully update after a restart.`);
    const android = root.android ?? null;  // future: {"version": "...", "url": "..."} for this patch
    if (!noticeShown && android?.version && newer(android.version, VERSION)) {
        noticeShown = true;
        log.warn(`GGX EN Patch for Android ${android.version} is out (this is ${VERSION}): ${android.url ?? ""}`);
    }
}

function* download(entry: any, path: string): Generator<Request, void, Response> {
    const url: string = entry.url;
    let bytes = (yield* get(url, true)).bytes;
    if (bytes === null) throw new Error(`${url}: empty response`);
    if (url.toLowerCase().endsWith(".gz")) bytes = gunzipSync(new Uint8Array(bytes)).buffer as ArrayBuffer;
    const hash = Checksum.compute("sha256", bytes);
    if (hash.toLowerCase() !== String(entry.sha256).toLowerCase())
        throw new Error(`${path.substring(path.lastIndexOf("/") + 1)}: checksum mismatch, not installed`);
    File.writeAllBytes(path + ".part", bytes);
    fs.move(path + ".part", path);
}

/** A manifest names files, never paths. */
function safeName(file: string): string {
    if (!file || file.includes("/") || file.includes("\\") || !file.toLowerCase().endsWith(".json"))
        throw new Error(`bad file name in manifest: ${file}`);
    return file;
}

function newer(a: string, b: string): boolean {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d > 0;
    }
    return false;
}
