package ggxen.patcher

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File
import java.util.concurrent.Executors

/** One screen: per game, its official and patched versions and a Patch / Update button; options; key backup. */
class MainActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var signer: Signer
    private lateinit var patcher: Patcher
    private lateinit var root: LinearLayout
    private lateinit var status: TextView
    private val busy get() = busyGame != null

    private val prefs by lazy { getSharedPreferences("options", MODE_PRIVATE) }
    private val boxes = linkedMapOf<String, CheckBox>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        signer = Signer(this)
        patcher = Patcher(this, signer)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        // Android 15+ draws edge to edge: keep the content clear of the status, navigation and cutout areas.
        setContentView(ScrollView(this).apply {
            addView(root)
            setOnApplyWindowInsetsListener { v, insets ->
                if (Build.VERSION.SDK_INT >= 30) {
                    val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                    v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                } else {
                    @Suppress("DEPRECATION")
                    v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
                }
                insets
            }
        })
        matchSystemBars()
        Installer.listener = { _, msg -> runOnUiThread { idle(msg) } }
    }

    /** Dark status/navigation bar icons on the light theme, light ones on the dark theme (values-night). */
    private fun matchSystemBars() {
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        if (Build.VERSION.SDK_INT >= 30) {
            val light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (night) 0 else light, light)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (night) 0 else
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or (if (Build.VERSION.SDK_INT >= 27) View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR else 0)
        }
    }

    private fun idle(message: String) {
        busyGame = null
        setStatus(message)
        render()
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun text(s: String, size: Float = 15f, bold: Boolean = false) = TextView(this).apply {
        text = s
        textSize = size
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(6), 0, dp(6))
    }

    private fun setStatus(s: String) {
        if (::status.isInitialized) status.text = s
    }

    private fun packageInfo(name: String): PackageInfo? = try {
        packageManager.getPackageInfo(name, 0)
    } catch (e: PackageManager.NameNotFoundException) {
        null
    }

    private fun isPatched(info: PackageInfo) =
        info.applicationInfo?.nativeLibraryDir?.let { File(it, "libggxen.so").exists() } == true

    private fun render() {
        val keep = if (::status.isInitialized) status.text else ""
        root.removeAllViews()
        root.addView(text("GGX EN Patcher", 22f, true))
        root.addView(text("English patch for Muv-Luv Girls Garden (X). The patched game is installed next to the " +
            "official one as its own app, \"… (EN)\". Keep the official app installed: the DMM GAMES STORE updates it, " +
            "and you tap Update here afterwards. Play the (EN) one."))

        for (game in Game.values()) {
            val official = packageInfo(game.official)
            val patched = packageInfo(game.patched)
            root.addView(text(game.title, 18f, true))
            val lines = mutableListOf<String>()
            lines += when {
                official == null -> "Official app: not installed (install it from the DMM GAMES STORE)"
                isPatched(official) -> "Official app: this is an old-style patched copy, not the official app. Uninstall it and install the official app from the DMM GAMES STORE."
                else -> "Official app: ${official.versionName}"
            }
            lines += if (patched == null) "English version: not installed" else "English version: ${patched.versionName}"
            root.addView(text(lines.joinToString("\n")))
            if (official != null && !isPatched(official)) {
                val upToDate = patched != null && patched.longVersion() == official.longVersion()
                val (label, working) = when {
                    patched == null -> "Install the English version" to "Installing…"
                    upToDate -> "Rebuild (apply changed options)" to "Rebuilding…"
                    else -> "Update the English version to ${official.versionName}" to "Updating…"
                }
                root.addView(Button(this).apply {
                    text = if (busyGame == game) busyLabel else label
                    isEnabled = !busy
                    setOnClickListener { start(game, working) }
                })
            }
        }

        root.addView(text("Options", 18f, true))
        root.addView(text("Baked into the English version: tap Rebuild after changing them.", 13f))
        option("includeR18", "Adult scene text (X only)", true)
        option("demosaic", "Turn off the mosaic (X only; changes only what this phone draws)", false)
        option("uninterruptedVoice", "Let voice lines finish when you advance", false)
        option("fitUiLabels", "Shrink long English labels to fit", true)
        option("shareScenes", "Share links to story scenes the translators lack (nothing about you)", true)
        option("sendUntranslatedUi", "Send untranslated menu text to the translators", true)

        root.addView(text("Your signing key", 18f, true))
        root.addView(text("Updates install over the English version only when they are signed with the same key. " +
            "Export it somewhere safe; if you reinstall this patcher or change phones, import it again.", 13f))
        root.addView(Button(this).apply { text = "Export key"; setOnClickListener { exportKey() } })
        root.addView(Button(this).apply { text = "Import key"; setOnClickListener { importKey() } })

        status = text(keep.toString(), 14f)
        root.addView(status)
    }

    private fun PackageInfo.longVersion(): Long =
        if (Build.VERSION.SDK_INT >= 28) longVersionCode else @Suppress("DEPRECATION") versionCode.toLong()

    private fun option(key: String, label: String, default: Boolean) {
        val box = CheckBox(this).apply {
            text = label
            isChecked = prefs.getBoolean(key, default)
            setOnCheckedChangeListener { _, v -> prefs.edit().putBoolean(key, v).apply() }
        }
        boxes[key] = box
        root.addView(box)
    }

    private fun options() = Options(
        includeR18 = prefs.getBoolean("includeR18", true),
        demosaic = prefs.getBoolean("demosaic", false),
        uninterruptedVoice = prefs.getBoolean("uninterruptedVoice", false),
        shareScenes = prefs.getBoolean("shareScenes", true),
        sendUntranslatedUi = prefs.getBoolean("sendUntranslatedUi", true),
        fitUiLabels = prefs.getBoolean("fitUiLabels", true),
    )

    private fun start(game: Game, working: String) {
        if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
            AlertDialog.Builder(this)
                .setMessage("Allow this app to install apps, then come back and tap the button again.")
                .setPositiveButton("Open settings") { _, _ ->
                    startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        busyGame = game
        busyLabel = working
        render()
        val options = options()
        worker.execute {
            try {
                val apk = patcher.patch(game, options) { msg -> runOnUiThread { setStatus(msg) } }
                runOnUiThread { setStatus("Installing… confirm on the next screen.") }
                Installer.install(this, apk, game.patched)
            } catch (e: Patcher.PatchError) {
                runOnUiThread { idle(e.message ?: "Failed.") }
            } catch (e: Throwable) {
                runOnUiThread { idle("Failed: ${e.javaClass.simpleName}: ${e.message}") }
            }
        }
    }

    private fun exportKey() {
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/x-pkcs12"
            putExtra(Intent.EXTRA_TITLE, "ggxen-patcher-key.p12")
        }, REQ_EXPORT)
    }

    private fun importKey() {
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }, REQ_IMPORT)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data ?: return
        if (resultCode != RESULT_OK) return
        try {
            when (requestCode) {
                REQ_EXPORT -> contentResolver.openOutputStream(uri)?.use { signer.export(it) }.also { setStatus("Key exported.") }
                REQ_IMPORT -> contentResolver.openInputStream(uri)?.use { signer.import(it) }.also { setStatus("Key imported.") }
            }
        } catch (e: Exception) {
            setStatus("Key file: ${e.message}")
        }
    }

    companion object {
        private const val REQ_EXPORT = 1
        private const val REQ_IMPORT = 2

        /** The game being built and installed, and the button text meanwhile ("Rebuilding…"); null when idle.
         *  Kept here, not on the screen, so switching dark mode mid-build (which recreates the screen) keeps it. */
        private var busyGame: Game? = null
        private var busyLabel = ""
    }
}
