// Ports of Demosaic.cs and UninterruptedVoice.cs ([QoL], both off by default). Purely client-side.
import { cls } from "./game.js";
import * as log from "./log.js";

const NEUTRAL_KEYWORD = "GGX_ENPATCH_NO_MOSAIC";

/** The mosaic is a URP renderer feature that only pixelates while its shader keyword is on: point the
 *  keyword at a name no shader uses. */
export function demosaic(): void {
    const feature = cls("Assembly-CSharp", "Assets.CustomRendererFeatures.MosaicRendererFeature");
    const neutralize = (f: Il2Cpp.Object) => {
        const settings = f.tryField<Il2Cpp.Object>("passSettings")?.value;
        if (!settings || settings.isNull()) return;
        const field = settings.tryField<Il2Cpp.String>("Keyword") ?? settings.tryField<Il2Cpp.String>("<Keyword>k__BackingField");
        const current = field ? field.value : settings.method<Il2Cpp.String>("get_Keyword").invoke();
        const keyword = current.isNull() ? null : current.content;
        if (keyword === NEUTRAL_KEYWORD) return;
        if (field) field.value = Il2Cpp.string(NEUTRAL_KEYWORD);
        else settings.method("set_Keyword").invoke(Il2Cpp.string(NEUTRAL_KEYWORD));
        log.info(`Demosaic: mosaic keyword "${keyword}" turned off.`);
    };
    feature.method("Create").implementation = function (this: any) {
        this.method("Create").invoke();
        try {
            neutralize(this);
        } catch (e) {
            log.errorOf("demosaic", e);
        }
    };
    // The renderer asset may already be loaded, with Create() run before the hook.
    try {
        const all = cls("UnityEngine.CoreModule", "UnityEngine.Resources")
            .method<Il2Cpp.Array<Il2Cpp.Object>>("FindObjectsOfTypeAll", 1).overload("System.Type").invoke(feature.type.object);
        for (let i = 0; i < all.length; i++) neutralize(all.get(i));
    } catch (e) {
        log.errorOf("demosaic", e);
    }
}

/** Advancing a story line calls AudioManager.StopVoice, which cuts the voice off: skip it while a scenario
 *  is open (the next voice gets its own source). Leaving the scenario stops voices as usual. Only void
 *  methods are hooked: UniTask-returning ones can't be intercepted safely. */
export function uninterruptedVoice(): void {
    let inScenario = false;
    const controller = cls("GameUi", "Assets.GameUi.Scenario.ScenarioController");
    const refresh = controller.methods.find(m => m.name === "Refresh" && m.parameterCount === 0 && m.returnType.name === "System.Void");
    if (refresh) refresh.implementation = function (this: any) {
        this.method("Refresh", 0).invoke();
        inScenario = true;
    };
    controller.method("StartPlayVoices").implementation = function (this: any, ...args: any[]) {
        const r = this.method("StartPlayVoices").invoke(...args);
        inScenario = true;
        return r;
    };
    cls("GameUi", "Assets.GameUi.Scenario.ScenarioComponent").method("OnDisable").implementation = function (this: any) {
        this.method("OnDisable").invoke();
        if (!inScenario) return;
        inScenario = false;
        try {
            const audio = this.method("get_AudioManager").invoke() as Il2Cpp.Object;
            if (!audio.isNull()) audio.method("StopVoice").invoke();  // its own StopVoice may have been skipped
        } catch (e) {
            log.errorOf("voice", e);
        }
    };
    cls("Externals", "Assets.GameUi.Externals.AudioManager").method("StopVoice").implementation = function (this: any, ...args: any[]) {
        if (inScenario) return;
        return this.method("StopVoice").invoke(...args);
    };
    log.info("UninterruptedVoice on.");
}
