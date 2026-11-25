// Port of ScenarioPatches.cs: story lines, speaker and team names.
// ConvertStringToDisplay: swap the raw fields first so the game formats the English itself (player name,
// ruby). ReplaceUsernamePlaceholder: the PC build inlines ConvertStringToDisplay into the frame builder,
// which still hands line, speaker and team to this service; hook both, whichever the build uses.
import { ctx } from "./ctx.js";
import { cls, str } from "./game.js";
import * as log from "./log.js";

const UNTRANSLATED_MARK = "[JP] ";
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/;

export function line(en: string): string {
    return ctx.settings.Text.LineBreaks === "Strip" ? en.replace(/\n/g, " ") : en;
}

function beforeDisplay(phrase: Il2Cpp.Object): void {
    const store = ctx.store;
    store.reloadIfChanged();
    const text = str(phrase.method("get_Text").invoke());
    if (text) {
        const en = store.lines[text];
        if (en !== undefined) phrase.method("set_Text").invoke(Il2Cpp.string(line(en)));
        else if (ctx.settings.Debug.MarkUntranslated && !text.startsWith(UNTRANSLATED_MARK) && JAPANESE.test(text))
            phrase.method("set_Text").invoke(Il2Cpp.string(UNTRANSLATED_MARK + text));
    }
    for (const prop of ["SpeakerName", "TeamName"]) {
        const jp = str(phrase.method(`get_${prop}`).invoke());
        if (jp === null) continue;
        const en = store.names[jp];
        if (en !== undefined && en !== jp) phrase.method(`set_${prop}`).invoke(Il2Cpp.string(en));
    }
}

export function install(): void {
    const phrase = cls("GameUi", "Assets.GameUi.Scenario.Configuration.ScenarioPhraseConfiguration");
    phrase.method("ConvertStringToDisplay").implementation = function (this: any, service: any) {
        try {
            beforeDisplay(this as Il2Cpp.Object);
        } catch (e) {
            log.errorOf("story", e);
        }
        return this.method("ConvertStringToDisplay").invoke(service);
    };

    const service = cls("GameUi", "Assets.GameUi.Services.ScenarioService");
    service.method("ReplaceUsernamePlaceholder").implementation = function (this: any, text: any) {
        let value = text;
        try {
            const jp = str(text);
            if (jp) {
                const store = ctx.store;
                store.reloadIfChanged();
                const en = store.lines[jp];
                const out = en !== undefined ? line(en) : store.name(jp);
                if (out !== jp) value = Il2Cpp.string(out);
            }
        } catch (e) {
            log.errorOf("story service", e);
        }
        return this.method("ReplaceUsernamePlaceholder").invoke(value);
    };
    log.info("Story hooks installed.");
}
