// Shared state, set up once in index.ts.
import type { Settings } from "./config.js";
import type { Store } from "./store.js";

export const VERSION = "0.1.0";
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
