// Signs and publishes the agent so patched apps update it by themselves (loader/index.ts, src/updater.ts).
//
//   node publish.mjs keygen    once: makes ../keys/agent-signing.pem and writes its public key to loader/key.ts
//   node publish.mjs sign      after `npm run build`: dist/android/agent-<version>.js + manifest-android.json
//   node publish.mjs upload    puts both in the R2 bucket (android/<file>), the manifest last
//
// The manifest names one agent; apps whose built-in agent is older download it, apps whose built-in agent is the
// same or newer delete their downloaded copy. To withdraw a broken release, sign and upload the previous version
// again under a higher version number. The private key never leaves this PC (keys/ is not in git).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = join(HERE, "../keys/agent-signing.pem");
const KEY_TS = join(HERE, "loader/key.ts");
const AGENT = join(HERE, "dist/agent.js");
const OUT = "dist/android";  // relative to HERE: wrangler gets ASCII paths
const BUCKET = "ggxen-tl";

const ctxSource = readFileSync(join(HERE, "src/ctx.ts"), "utf8");
const constant = name => {
    const m = ctxSource.match(new RegExp(`export const ${name} = "?([^";]+)"?;`));
    if (!m) throw new Error(`${name} not found in src/ctx.ts`);
    return m[1];
};
const VERSION = constant("VERSION");
const LOADER_API = Number(constant("LOADER_API"));
const PACK_URL = constant("DEFAULT_PACK_URL");

/** Same text as loader/api.ts message(). */
const message = d => `ggxen-agent\nversion ${d.version}\nloader ${d.loader}\nfrida ${d.frida}\nsha256 ${d.sha256.toLowerCase()}\n`;

const rawPublic = key => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

function keygen() {
    if (existsSync(KEY)) throw new Error(`${KEY} exists; refusing to replace it (every patched app trusts it)`);
    const { privateKey } = generateKeyPairSync("ed25519");
    mkdirSync(dirname(KEY), { recursive: true });
    writeFileSync(KEY, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
    writeKeyTs(rawPublic(privateKey));
    console.log(`wrote ${KEY} (back it up outside this PC) and loader/key.ts`);
}

function writeKeyTs(hex) {
    writeFileSync(KEY_TS, `// Public half of keys/agent-signing.pem (publish.mjs keygen). Agents signed with it may replace the built-in one.\n` +
        `export const PUBLIC_KEY = "${hex}";\n`);
}

function fridaVersion() {
    const names = readdirSync(join(HERE, "../tools")).filter(n => /^frida-gadget-.*-android-arm64\.so$/.test(n)).sort();
    if (names.length === 0) throw new Error("no frida-gadget in ../tools");
    return names[names.length - 1].match(/^frida-gadget-(.+)-android-arm64\.so$/)[1];
}

function newestSource(dir) {
    let t = 0;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        t = Math.max(t, e.isDirectory() ? newestSource(p) : statSync(p).mtimeMs);
    }
    return t;
}

function signAgent() {
    const key = createPrivateKey(readFileSync(KEY));
    const embedded = readFileSync(KEY_TS, "utf8").match(/PUBLIC_KEY = "([0-9a-f]{64})"/)?.[1];
    if (embedded !== rawPublic(key)) throw new Error("loader/key.ts doesn't hold this key's public half");
    if (statSync(AGENT).mtimeMs < newestSource(join(HERE, "src"))) throw new Error("dist/agent.js is older than src/: run npm run build");
    const bytes = readFileSync(AGENT);
    if (!bytes.subarray(0, 4).equals(Buffer.from("📦"))) throw new Error("dist/agent.js isn't a frida-compile bundle");
    const file = `agent-${VERSION}.js`;
    const d = {
        version: VERSION,
        loader: LOADER_API,
        frida: fridaVersion(),
        sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    d.sig = sign(null, Buffer.from(message(d), "ascii"), key).toString("hex");
    if (!verify(null, Buffer.from(message(d), "ascii"), createPublicKey(key), Buffer.from(d.sig, "hex"))) throw new Error("signature check failed");
    Object.assign(d, { file, url: `${PACK_URL}/android/${file}`, size: bytes.length });
    const manifest = { channel: "android", published: new Date().toISOString(), agent: d };
    mkdirSync(join(HERE, OUT), { recursive: true });
    writeFileSync(join(HERE, OUT, file), bytes);
    writeFileSync(join(HERE, OUT, "manifest-android.json"), JSON.stringify(manifest, null, 1) + "\n");
    console.log(`signed agent ${VERSION} (loader ${d.loader}, Frida ${d.frida}, ${bytes.length.toLocaleString()} bytes, sha256 ${d.sha256.slice(0, 16)}…)`);
}

function upload() {
    const manifest = JSON.parse(readFileSync(join(HERE, OUT, "manifest-android.json"), "utf8"));
    const put = (name, type, cache) => {
        const r = spawnSync("npx", ["--yes", "wrangler", "r2", "object", "put", `${BUCKET}/android/${name}`,
            "--file", `${OUT}/${name}`, "--remote", "--content-type", type, "--cache-control", `"${cache}"`],
            { cwd: HERE, stdio: "inherit", shell: true });
        if (r.status !== 0) throw new Error(`upload of ${name} failed`);
        console.log(`uploaded android/${name}`);
    };
    put(manifest.agent.file, "application/javascript", "public, max-age=31536000, immutable");
    put("manifest-android.json", "application/json", "no-cache");
}

const cmd = process.argv[2];
({ keygen, sign: signAgent, upload }[cmd] ?? (() => { console.log("node publish.mjs keygen | sign | upload"); process.exit(2); }))();
