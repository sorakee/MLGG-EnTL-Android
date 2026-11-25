// Shared state, set up once in index.ts, and the constants the loader shares.
import type { Settings } from "./config.js";
import type { Store } from "./store.js";

export const VERSION = "0.2.2";
/** What the loader offers (loader/api.ts). Raise it when the agent starts relying on something new there:
 *  agents built from then on run only under loaders (patchers) that have it. */
export const LOADER_API = 1;
export const DEFAULT_PACK_URL = "https://pub-c34991024c2e4fa89421fb9c498384c0.r2.dev";
export const DEFAULT_REPORT_URL = "https://ggxen-report.ggxen.workers.dev";
export const X_PACKAGE = "jp.co.fanzagames.muvluv_ggx_app";

export const ctx = {
    /** <persistentDataPath>/ggxen: config.json, log.txt, translations/, ui-untranslated.tsv */
    base: "",
    settings: null as unknown as Settings,
    store: null as unknown as Store,
    isX: false,
};

/** Dotted version a is newer than b. */
export function newer(a: string, b: string): boolean {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d > 0;
    }
    return false;
}
