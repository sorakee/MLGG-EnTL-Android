package ggxen.patcher

import android.content.Context
import com.reandroid.apk.ApkModule
import com.reandroid.archive.ByteInputSource
import com.reandroid.archive.FileInputSource
import com.reandroid.arsc.chunk.xml.ResXmlAttribute
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * Builds the patched copy from the official app's installed APK (any app may read another app's APK):
 *  - package renamed to <official>.en, provider authorities with it, label "<title> (EN)"; the DMM login
 *    callback scheme stays as it is (tested: login works);
 *  - lib/arm64-v8a: libmain.so swapped for one that also loads libggxen.so (prebuilt per Unity version, keyed by
 *    the original's SHA-256), plus libggxen.so (Frida Gadget), its config, the agent and the baked settings;
 *  - old signature dropped, then signed with this player's key (Signer).
 */
class Patcher(private val context: Context, private val signer: Signer) {

    class PatchError(message: String) : Exception(message)

    fun patch(game: Game, options: Options, progress: (String) -> Unit): File {
        val info = try {
            context.packageManager.getApplicationInfo(game.official, 0)
        } catch (e: Exception) {
            throw PatchError("${game.title} isn't installed. Install it from the DMM GAMES STORE first.")
        }
        if (!info.splitSourceDirs.isNullOrEmpty()) throw PatchError("This game version is split into several APKs; the patcher can't handle that yet.")
        val work = File(context.cacheDir, "work").apply { deleteRecursively(); mkdirs() }
        val unsigned = File(work, "unsigned.apk")

        progress("Reading the official app…")
        val module = ApkModule.loadApkFile(File(info.sourceDir))
        try {
            if (module.containsFile(LIB + "libggxen.so"))
                throw PatchError("The installed ${game.title} is already a patched copy. Uninstall it and install the official app from the DMM GAMES STORE.")
            val manifest = module.androidManifest
            val old = manifest.packageName
            if (old != game.official) throw PatchError("Unexpected package name $old.")

            progress("Renaming the package…")
            // Manifest AND resource table: Unity looks up its own strings with getIdentifier(name, "string",
            // getPackageName()), which finds nothing (and crashes the game) if the table keeps the old name.
            module.setPackageName(game.patched)
            if (module.hasTableBlock()) for (pkg in module.tableBlock.listPackages()) if (pkg.name == old) pkg.name = game.patched
            if (manifest.packageName != game.patched) manifest.packageName = game.patched
            val attrs = manifest.manifestElement.recursiveAttributes()
            while (attrs.hasNext()) {
                val a = attrs.next() as ResXmlAttribute
                if (a.name != "authorities") continue
                val value = a.valueAsString ?: continue
                val renamed = value.split(';').joinToString(";") { if (it.startsWith("$old.")) game.patched + it.substring(old.length) else it }
                if (renamed != value) a.setValueAsString(renamed)
            }
            manifest.setApplicationLabel(game.patchedLabel)
            module.refreshManifest()

            progress("Adding the patch…")
            val libmain = module.getInputSource(LIB + "libmain.so") ?: throw PatchError("libmain.so not found.")
            val sha = libmain.openStream().use { sha256(it) }
            val patchedLibmain = try {
                context.assets.open("libmain/$sha.so").use { it.readBytes() }
            } catch (e: Exception) {
                throw PatchError("This game version uses an engine build the patcher doesn't know yet (libmain $sha). Update the patcher.")
            }
            replace(module, ByteInputSource(patchedLibmain, LIB + "libmain.so"), libmain)
            val gadget = File(work, "libggxen.so")
            context.assets.open("libggxen.so").use { input -> gadget.outputStream().use { input.copyTo(it) } }
            replace(module, FileInputSource(gadget, LIB + "libggxen.so"), libmain)
            replace(module, ByteInputSource(CONFIG.toByteArray(), LIB + "libggxen.config.so"), libmain)
            replace(module, ByteInputSource(context.assets.open("agent.js").use { it.readBytes() }, LIB + "libggxen-agent.so"), libmain)
            replace(module, ByteInputSource(options.toJson(game).toByteArray(), LIB + "libggxen-settings.so"), libmain)

            // The official v1 signature files and v2/v3 block don't fit the changed APK.
            module.zipEntryMap.removeIf { src ->
                val n = src.name
                n.startsWith("META-INF/") && (n.endsWith(".SF") || n.endsWith(".RSA") || n.endsWith(".EC") ||
                    n.endsWith(".DSA") || n == "META-INF/MANIFEST.MF")
            }
            module.apkSignatureBlock = null

            progress("Writing the patched app…")
            module.writeApk(unsigned)
        } finally {
            module.close()
        }

        progress("Signing with your key…")
        val signed = File(work, "patched.apk")
        signer.sign(unsigned, signed)
        unsigned.delete()
        File(work, "libggxen.so").delete()
        return signed
    }

    /** Adds (or replaces) an entry, with the compression of a reference entry (native libraries). */
    private fun replace(module: ApkModule, source: com.reandroid.archive.InputSource, like: com.reandroid.archive.InputSource) {
        source.method = like.method
        module.zipEntryMap.remove(source.name)
        module.add(source)
    }

    companion object {
        const val LIB = "lib/arm64-v8a/"
        /** Gadget config: run the agent next to it (no listening port), V8 engine. */
        const val CONFIG = """{"interaction":{"type":"script","path":"./libggxen-agent.so","on_change":"ignore"},"runtime":"v8","teardown":"minimal"}"""

        fun sha256(input: InputStream): String {
            val md = MessageDigest.getInstance("SHA-256")
            val buf = ByteArray(1 shl 16)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
            return md.digest().joinToString("") { "%02x".format(it) }
        }
    }
}
