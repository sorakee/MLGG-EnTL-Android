// What the loader gives the agent, as globalThis.ggxenLoader (absent when the agent runs without it, e.g.
// through dev_attach.py). Additions raise LOADER_API (src/ctx.ts).

/** One agent build, as android/manifest-android.json names it (publish.mjs). The signature covers
 *  version, loader, frida and sha256 (see message()). */
export interface AgentDescriptor {
    version: string;
    /** The LOADER_API the agent needs. */
    loader: number;
    /** The oldest Frida (gadget) version it runs on. */
    frida: string;
    /** SHA-256 of the agent file (a frida-compile bundle), lower-case hex. */
    sha256: string;
    /** Ed25519 signature of message(this), hex. */
    sig: string;
    url?: string;
    file?: string;
    size?: number;
}

export interface LoaderApi {
    api: number;
    /** The agent baked into this APK. */
    bakedVersion: string;
    running: { version: string, source: "baked" | "downloaded" };
    /** Version of the downloaded agent kept on the phone (agent.json), whether or not it runs. */
    downloaded: string | null;
    /** Downloaded versions that failed to start; never run again. */
    bad: string[];
    /** What the loader logged before the agent opened log.txt: [level, message]. */
    notes: [string, string][];
    /** Why this agent can't run here (bad signature, needs a newer patcher, not newer than the baked one), or null. */
    check(d: AgentDescriptor): string | null;
    /** Checks the descriptor and the file, then keeps them for the next launch. Throws on any problem. */
    install(d: AgentDescriptor, bytes: ArrayBuffer): void;
    /** Deletes the downloaded agent: the baked one runs from the next launch on. */
    remove(): void;
    /** The running agent started fine: clears the failed-start count. */
    confirm(): void;
}

/** The signed text. publish.mjs builds the same. */
export function message(d: AgentDescriptor): string {
    return `ggxen-agent\nversion ${d.version}\nloader ${d.loader}\nfrida ${d.frida}\nsha256 ${d.sha256.toLowerCase()}\n`;
}
