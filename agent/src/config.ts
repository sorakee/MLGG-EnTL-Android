// Settings: <base>/config.json, the same sections and keys as the PC plugin's ggx.enpatch.cfg.
// Missing keys get their defaults and are written back, so the file always lists every setting.
import * as log from "./log.js";

export type LineBreakMode = "Keep" | "Strip";

export interface Settings {
    Text: { LineBreaks: LineBreakMode, FitUiLabels: boolean };
    Debug: { MarkUntranslated: boolean };
    Report: { LogUntranslatedUi: boolean, ShareScenes: boolean, SendUntranslatedUi: boolean, ReportUrl: string };
    Update: { AutoUpdate: boolean, IncludeR18: boolean, UpdatePatch: boolean, PackUrl: string };
    QoL: { Demosaic: boolean, UninterruptedVoice: boolean };
}

const HELP = {
    "Text.LineBreaks": "Keep: line breaks as written in the translation. Strip: spaces instead; the text box wraps.",
    "Text.FitUiLabels": "Let translated menu labels shrink (down to 60%) to fit their box instead of overflowing.",
    "Debug.MarkUntranslated": "Prefix story lines that have no translation yet with \"[JP] \".",
    "Report.LogUntranslatedUi": "Write each Japanese menu text that has no English yet, once, to ui-untranslated.tsv.",
    "Report.ShareScenes": "Send the download link of a story scene the translators have no copy of (nothing about you).",
    "Report.SendUntranslatedUi": "Send the rows of ui-untranslated.tsv to the translators. Needs LogUntranslatedUi.",
    "Report.ReportUrl": "Where reports go. Empty: the patch's own report service.",
    "Update.AutoUpdate": "On launch, download new translation packs (from PackUrl only; nothing about you is sent).",
    "Update.IncludeR18": "Also download the adult scenes' text (the X app only).",
    "Update.UpdatePatch": "On launch, also download fixes to the patch itself (signed by the translators; checked before every start). Needs AutoUpdate.",
    "Update.PackUrl": "Where the translation packs are published. Empty: the patch's own address.",
    "QoL.Demosaic": "Turn off the mosaic filter in scenes. Only changes what is drawn on this phone.",
    "QoL.UninterruptedVoice": "In story scenes, let a voice line finish when you advance instead of cutting it off.",
};

export function defaults(isX: boolean): Settings {
    return {
        Text: { LineBreaks: "Keep", FitUiLabels: true },
        Debug: { MarkUntranslated: false },
        Report: { LogUntranslatedUi: true, ShareScenes: true, SendUntranslatedUi: true, ReportUrl: "" },
        Update: { AutoUpdate: true, IncludeR18: isX, UpdatePatch: true, PackUrl: "" },
        QoL: { Demosaic: false, UninterruptedVoice: false },
    };
}

function readJson(path: string, what: string): any {
    let text: string | null = null;
    try {
        text = File.readAllText(path);
        return JSON.parse(text);
    } catch (e) {
        if (text !== null) log.warn(`${what} unreadable (${e}); ignored`);
        return null;
    }
}

function apply(settings: any, from: any): void {
    if (!from) return;
    for (const section of Object.keys(settings))
        for (const key of Object.keys(settings[section])) {
            const value = from?.[section]?.[key];
            if (value !== undefined && typeof value === typeof settings[section][key]) settings[section][key] = value;
        }
}

/** Defaults, then config.json, then the choices the patcher app baked into the APK (bakedPath): those win,
 *  since players can't edit files under Android/data. config.json is rewritten with the effective values. */
export function load(path: string, isX: boolean, bakedPath: string | null): Settings {
    const settings: any = defaults(isX);
    const stored = readJson(path, "config.json");
    apply(settings, stored);
    if (bakedPath !== null) apply(settings, readJson(bakedPath, "baked settings"));
    let text: string | null = null;
    try {
        text = File.readAllText(path);
    } catch {
        text = null;
    }
    if (settings.Text.LineBreaks !== "Strip") settings.Text.LineBreaks = "Keep";
    const out = JSON.stringify({ ...settings, _help: HELP }, null, 2) + "\n";
    if (out !== text) {
        try {
            File.writeAllText(path, out);
        } catch (e) {
            log.warn(`can't write config.json: ${e}`);
        }
    }
    return settings as Settings;
}
