package ggxen.patcher

/** The two apps the patch supports. The patched copy is installed beside the official one under its own
 *  package name, so the DMM GAMES STORE keeps updating the official app and the patcher follows it. */
enum class Game(val official: String, val title: String, val isX: Boolean) {
    X("jp.co.fanzagames.muvluv_ggx_app", "Muv-Luv Girls Garden X", true),
    ALL_AGES("com.dmm.dmmgames.muvluv_gg_app", "Muv-Luv Girls Garden", false);

    val patched get() = "$official.en"
    val patchedLabel get() = "$title (EN)"
}

/** Choices baked into the patched app (libggxen-settings.so); the agent reads them as its settings. */
data class Options(
    val includeR18: Boolean = true,
    val demosaic: Boolean = false,
    val uninterruptedVoice: Boolean = false,
    val shareScenes: Boolean = true,
    val sendUntranslatedUi: Boolean = true,
    val fitUiLabels: Boolean = true,
    val updatePatch: Boolean = true,
) {
    fun toJson(game: Game): String {
        val r18 = includeR18 && game.isX
        val demo = demosaic && game.isX
        return """{"Text":{"FitUiLabels":$fitUiLabels},"Report":{"LogUntranslatedUi":true,"ShareScenes":$shareScenes,""" +
            """"SendUntranslatedUi":$sendUntranslatedUi},"Update":{"IncludeR18":$r18,"UpdatePatch":$updatePatch},""" +
            """"QoL":{"Demosaic":$demo,"UninterruptedVoice":$uninterruptedVoice}}"""
    }
}
