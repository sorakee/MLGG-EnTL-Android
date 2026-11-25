// Port of Updater.cs: on launch, read each channel's manifest (pack/publish.py) and bring translations/ up to
// date: the base pack when the manifest names another one, then the update packs not here yet; updates the
// manifest no longer lists are deleted. Files are checked against the manifest's SHA-256 (of the uncompressed
// JSON; a .gz url is gunzipped) and written under a temporary name first; the store reloads them by itself.
// A channel whose local base is a dev pack is left alone. Then the patch's own code (updateAgent). Only the
// manifest, pack and agent URLs (all under PackUrl) are contacted.
// Requests go through the game's UnityWebRequest, stepped from the main-thread tick (a generator per job).
import { gunzipSync } from "fflate/browser";  // the Node build needs Node's module API
import { ctx, newer, VERSION } from "./ctx.js";
import * as fs from "./fs.js";
import * as http from "./http.js";
import type { Request, Response } from "./http.js";
import * as log from "./log.js";
import { PackInfo } from "./store.js";

type Job = Generator<Request, void, Response>;

let job: Job | null = null;

/** Queues the update (http.ts sends it from the first frame on): the channels' packs, then, with agentUrl,
 *  the patch's own code. */
export function start(manifestUrls: string[], agentUrl: string | null): void {
    job = run([...new Set(manifestUrls.map(u => u.trim()).filter(u => u.length > 0))], agentUrl);
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

function* run(urls: string[], agentUrl: string | null): Job {
    for (const url of urls) {
        try {
            yield* update(url);
        } catch (e) {
            log.warn(`Translation update from ${url} failed: ${e}`);
        }
    }
    if (agentUrl !== null) {
        try {
            yield* updateAgent(agentUrl);
        } catch (e) {
            log.warn(`Patch update from ${agentUrl} failed: ${e}`);
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
}

/** The patch's own code: keep the agent android/manifest-android.json names (publish.mjs) when it is newer than
 *  the one built into this app; the loader checks its signature here and again on every launch. */
function* updateAgent(url: string): Generator<Request, void, Response> {
    const loader = globalThis.ggxenLoader;
    if (loader === undefined) return;
    const a = JSON.parse((yield* get(url, false)).text ?? "").agent;
    if (typeof a?.version !== "string") throw new Error("manifest names no agent");
    if (!newer(a.version, loader.bakedVersion)) {
        const old = loader.downloaded;
        if (old !== null) {
            loader.remove();
            log.info(`Patch: removed the downloaded agent ${old}; the built-in ${loader.bakedVersion} runs from the next launch.`);
        } else {
            log.info(`Patch: up to date (${VERSION}).`);
        }
        return;
    }
    if (loader.downloaded === a.version) {
        log.info(loader.running.version === a.version ? `Patch: up to date (${VERSION}).`
            : `Patch: agent ${a.version} is downloaded and starts on the next launch.`);
        return;
    }
    if (loader.bad.includes(a.version)) {
        log.warn(`Patch: agent ${a.version} failed to start on this phone before; staying on ${VERSION}.`);
        return;
    }
    const why = loader.check(a);
    if (why !== null) {
        log.warn(`Patch: agent ${a.version} is out but can't run here: ${why}.`);
        return;
    }
    const bytes = (yield* get(a.url, true)).bytes;
    if (bytes === null) throw new Error(`${a.url}: empty response`);
    loader.install(a, bytes);
    log.info(`Patch: downloaded agent ${a.version} (running ${VERSION}); it starts on the next launch.`);
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

