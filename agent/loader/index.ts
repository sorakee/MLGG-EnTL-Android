// The gadget's script (lib/arm64-v8a/libggxen-loader.so). It starts the agent: the one baked into the APK
// (libggxen-agent.so), or a newer one the agent downloaded earlier (files/ggxen-agent/ in the app's internal
// storage), but only if that one is signed with the key in key.ts and its file matches the signed hash. It
// checks again on every launch. A downloaded agent that fails to start MAX_STARTS times in a row (no confirm()
// from it) is set aside and the baked one runs. Keep this small: changes reach players only with a patcher release.
import * as ed from "@noble/ed25519";
import { LOADER_API, newer, VERSION as BAKED } from "../src/ctx.js";
import * as fs from "../src/fs.js";
import { message } from "./api.js";
import type { AgentDescriptor, LoaderApi } from "./api.js";
import { PUBLIC_KEY } from "./key.js";

const MAX_STARTS = 3;

const logWrite = new NativeFunction(
    Process.getModuleByName("liblog.so").getExportByName("__android_log_write"), "int", ["int", "pointer", "pointer"]);
const tag = Memory.allocUtf8String("GGXEN");
const notes: [string, string][] = [];

function note(level: "Info" | "Warning" | "Error", m: string): void {
    notes.push([level, `Loader: ${m}`]);
    logWrite(level === "Info" ? 4 : level === "Warning" ? 5 : 6, tag, Memory.allocUtf8String(`Loader: ${m}`));
}

function hexBytes(hex: string): Uint8Array {
    const b = new Uint8Array(hex.length >> 1);
    for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
    return b;
}

const bufferOf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
(ed.hashes as any).sha512 = (m: Uint8Array) => hexBytes(Checksum.compute("sha512", bufferOf(m)));
const sha256 = (bytes: ArrayBuffer) => Checksum.compute("sha256", bytes).toLowerCase();
const ascii = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);

note("Info", `loader ${LOADER_API} (Frida ${Frida.version}), built-in agent ${BAKED}.`);

function main(): void {
    // --- where things are

    const getuid = new NativeFunction(Process.getModuleByName("libc.so").getExportByName("getuid"), "uint32", []);

    const cmdline = new Uint8Array(File.readAllBytes("/proc/self/cmdline"));  // NUL-separated: readAllText refuses it
    let packageName = "";
    for (let i = 0; i < cmdline.length && cmdline[i] !== 0; i++) packageName += String.fromCharCode(cmdline[i]);
    packageName = packageName.split(":")[0];
    const dir = `/data/user/${Math.floor((getuid() as number) / 100000)}/${packageName}/files/ggxen-agent`;
    const JS = `${dir}/agent.js`, JSON_ = `${dir}/agent.json`, STATE = `${dir}/state.json`;

    function readJson(path: string): any {
        try {
            return JSON.parse(File.readAllText(path));
        } catch {
            return null;
        }
    }

    // --- state: failed starts and set-aside versions

    const state: { bad: string[], pending: { version: string, starts: number } | null } = { bad: [], pending: null };
    {
        const s = readJson(STATE);
        if (Array.isArray(s?.bad)) state.bad = s.bad.filter((v: any) => typeof v === "string");
        if (typeof s?.pending?.version === "string" && typeof s.pending.starts === "number") state.pending = s.pending;
    }

    function saveState(): void {
        try {
            fs.mkdirs(dir);
            File.writeAllText(STATE, JSON.stringify(state));
        } catch (e) {
            note("Warning", `can't write ${STATE}: ${e}`);
        }
    }

    // --- checks

    function check(d: AgentDescriptor): string | null {
        if (typeof d !== "object" || d === null) return "no descriptor";
        if (typeof d.version !== "string" || !/^\d+(\.\d+){1,3}$/.test(d.version)) return "bad version";
        if (typeof d.loader !== "number" || typeof d.frida !== "string" || typeof d.sha256 !== "string" ||
            typeof d.sig !== "string" || !/^[0-9a-f]{128}$/i.test(d.sig) || !/^[0-9a-f]{64}$/i.test(d.sha256))
            return "incomplete descriptor";
        try {
            if (!ed.verify(hexBytes(d.sig), ascii(message(d)), hexBytes(PUBLIC_KEY))) return "bad signature";
        } catch (e) {
            return `bad signature (${e})`;
        }
        if (d.loader > LOADER_API) return `needs a newer patcher (loader ${d.loader}, this one has ${LOADER_API})`;
        if (newer(d.frida, Frida.version)) return `needs a newer patcher (Frida ${d.frida}, this one has ${Frida.version})`;
        if (!newer(d.version, BAKED)) return `not newer than the built-in agent ${BAKED}`;
        return null;
    }

    // --- running a frida-compile bundle: "📦\n", "<size> <name>\n" per file, "✄\n", the files joined by "\n✄\n"

    function unbundle(bytes: ArrayBuffer): { name: string, code: string, map: string | null } {
        const u = new Uint8Array(bytes);
        const mem = Memory.alloc(u.length + 1);
        mem.writeByteArray(bytes);
        mem.add(u.length).writeU8(0);
        const lineEnd = (from: number) => {
            let i = from;
            while (i < u.length && u[i] !== 0x0a) i++;
            return i;
        };
        let pos = lineEnd(0);
        if (mem.readUtf8String(pos) !== "📦") throw new Error("not a frida-compile bundle");
        const files: { size: number, name: string }[] = [];
        for (; ;) {
            const start = pos + 1, end = lineEnd(start);
            const line = mem.add(start).readUtf8String(end - start)!;
            pos = end;
            if (line === "✄") break;
            const space = line.indexOf(" ");
            files.push({ size: parseInt(line.substring(0, space), 10), name: line.substring(space + 1) });
            if (end >= u.length) throw new Error("bundle header not terminated");
        }
        let at = pos + 1;
        const texts = new Map<string, string>();
        for (const f of files) {
            if (at + f.size > u.length) throw new Error("bundle truncated");
            texts.set(f.name, mem.add(at).readUtf8String(f.size)!);
            at += f.size + 5;  // "\n✄\n"
        }
        const main = files.find(f => f.name.endsWith(".js"));
        if (!main) throw new Error("bundle has no module");
        return { name: main.name, code: texts.get(main.name)!, map: texts.get(main.name + ".map") ?? null };
    }

    function start(bytes: ArrayBuffer, source: string): Promise<unknown> {
        const b = unbundle(bytes);
        const name = `/${source}${b.name.startsWith("/") ? "" : "/"}${b.name}`;
        if (b.map !== null) Script.registerSourceMap(name, b.map);
        return Script.load(name, b.code).then(() => note("Info", `${source} agent loaded.`));
    }

    // --- pick and run

    const lib = fs.libDir();
    const stored: AgentDescriptor | null = readJson(JSON_);

    const api: LoaderApi = {
        api: LOADER_API,
        bakedVersion: BAKED,
        running: { version: BAKED, source: "baked" },
        downloaded: typeof stored?.version === "string" ? stored.version : null,
        bad: state.bad,
        notes,
        check,
        install(d: AgentDescriptor, bytes: ArrayBuffer): void {
            const why = check(d);
            if (why !== null) throw new Error(why);
            if (sha256(bytes) !== d.sha256.toLowerCase()) throw new Error("file doesn't match its signed hash");
            unbundle(bytes);
            fs.mkdirs(dir);
            File.writeAllBytes(`${JS}.part`, bytes);
            File.writeAllText(`${JSON_}.part`, JSON.stringify(d));
            fs.remove(JSON_);  // never a descriptor next to another version's file
            fs.move(`${JS}.part`, JS);
            fs.move(`${JSON_}.part`, JSON_);
            api.downloaded = d.version;
        },
        remove(): void {
            fs.remove(JSON_);
            fs.remove(JS);
            api.downloaded = null;
        },
        confirm(): void {
            if (state.pending === null) return;
            state.pending = null;
            saveState();
        },
    };
    (globalThis as any).ggxenLoader = api;

    function pickDownloaded(): ArrayBuffer | null {
        if (stored === null) return null;
        const why = check(stored) ?? (state.bad.includes(stored.version) ? "it failed to start before" : null);
        if (why !== null) {
            note("Info", `downloaded agent ${stored.version} not used: ${why}.`);
            return null;
        }
        let bytes: ArrayBuffer;
        try {
            bytes = File.readAllBytes(JS);
        } catch (e) {
            note("Warning", `downloaded agent ${stored.version} unreadable: ${e}`);
            return null;
        }
        if (sha256(bytes) !== stored.sha256.toLowerCase()) {
            note("Warning", `downloaded agent ${stored.version} doesn't match its signed hash; not used.`);
            return null;
        }
        const v = stored.version;
        const starts = state.pending?.version === v ? state.pending.starts : 0;
        if (starts >= MAX_STARTS) {
            note("Warning", `downloaded agent ${v} failed to start ${starts} times in a row; set aside, the built-in ${BAKED} runs.`);
            state.bad.push(v);
            state.pending = null;
            saveState();
            return null;
        }
        state.pending = { version: v, starts: starts + 1 };
        saveState();
        return bytes;
    }

    function runBaked(): void {
        api.running = { version: BAKED, source: "baked" };
        start(File.readAllBytes(`${lib}/libggxen-agent.so`), "baked")
            .catch(e => note("Error", `built-in agent ${BAKED} failed to load: ${e?.stack ?? e}`));
    }

    function failed(v: string, e: any): void {
        note("Error", `downloaded agent ${v} failed to load: ${e?.stack ?? e}; set aside.`);
        state.bad.push(v);
        state.pending = null;
        saveState();
        runBaked();
    }

    let downloaded: ArrayBuffer | null = null;
    try {
        downloaded = pickDownloaded();
    } catch (e) {
        note("Error", `${e}`);
    }
    if (downloaded === null) {
        runBaked();
    } else {
        const v = stored!.version;
        api.running = { version: v, source: "downloaded" };
        note("Info", `running downloaded agent ${v} (built-in: ${BAKED}).`);
        try {
            start(downloaded, "downloaded").catch(e => failed(v, e));
        } catch (e) {
            failed(v, e);
        }
    }
}

try {
    main();
} catch (e) {
    note("Error", `${(e as any)?.stack ?? e}`);
}
