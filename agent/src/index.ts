// GGX EN Patch for Android: the agent Frida Gadget runs inside the game (android/patch_apk.py injects it).
// Port of the PC plugin (plugin/GGXEnPatch/src). Files live in <persistentDataPath>/ggxen.
import "frida-il2cpp-bridge";
import * as config from "./config.js";
import { ctx, DEFAULT_PACK_URL, VERSION, X_PACKAGE } from "./ctx.js";
import * as fs from "./fs.js";
import { every, startTicking } from "./game.js";
import * as http from "./http.js";
import * as log from "./log.js";
import * as reporter from "./reporter.js";
import * as master from "./master.js";
import * as qol from "./qol.js";
import { Store } from "./store.js";
import * as story from "./story.js";
import * as textfit from "./textfit.js";
import * as ui from "./ui.js";
import * as updater from "./updater.js";

function step(name: string, fn: () => void): void {
    try {
        fn();
    } catch (e) {
        log.errorOf(name, e);
    }
}

Il2Cpp.perform(() => {
    const app = Il2Cpp.application;
    ctx.isX = app.identifier === X_PACKAGE || app.identifier.startsWith(X_PACKAGE + ".");  // patched copy: <official>.en
    ctx.base = `${app.dataPath}/ggxen`;
    fs.mkdirs(ctx.base);
    log.openLogFile(`${ctx.base}/log.txt`);
    log.info(`GGX EN Patch for Android ${VERSION}: ${app.identifier} ${app.version}, Unity ${Il2Cpp.unityVersion}.`);
    // The patcher app bakes the player's choices in next to the agent (lib/arm64-v8a/libggxen-settings.so).
    const libmain = Process.getModuleByName("libmain.so").path;
    const baked = `${libmain.substring(0, libmain.lastIndexOf("/"))}/libggxen-settings.so`;
    ctx.settings = config.load(`${ctx.base}/config.json`, ctx.isX, fs.exists(baked) ? baked : null);
    ctx.store = new Store(`${ctx.base}/translations`);
    step("store", () => ctx.store.reload());

    const s = ctx.settings;
    if (s.Update.AutoUpdate) step("updater", () => {
        const url = (s.Update.PackUrl.trim() || DEFAULT_PACK_URL).replace(/\/+$/, "");
        const channels = ctx.isX && s.Update.IncludeR18 ? ["main", "r18"] : ["main"];
        if (!channels.includes("r18")) updater.removeChannel("r18");
        updater.start(channels.map(c => `${url}/${c}/manifest-${c}.json`));
    });
    step("story", story.install);
    step("ui", ui.install);
    step("textfit", textfit.install);
    if (s.QoL.Demosaic && ctx.isX) step("demosaic", qol.demosaic);
    if (s.QoL.UninterruptedVoice) step("voice", qol.uninterruptedVoice);

    step("reporter", reporter.start);

    every(0, "http", http.tick);
    every(0, "reporter", reporter.tick);
    every(0, "master text", master.tick);
    every(1, "text fit", textfit.tick);
    step("tick", startTicking);
    log.info("Loaded.");
}, "main").catch(e => log.errorOf("startup", e));
