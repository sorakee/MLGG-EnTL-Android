package ggxen.patcher

import android.content.Context
import com.android.apksig.ApkSigner
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * This player's signing key: RSA 2048 with a self-signed certificate, made on first use and kept in the app's
 * private files (key.p12). Every patched build is signed with it, so a new build installs over the old one
 * and keeps the game's data. Losing it means uninstalling the patched game once, so it can be exported.
 */
class Signer(private val context: Context) {
    private val file = File(context.filesDir, "key.p12")
    private val password = "ggxen".toCharArray()  // the file is private to this app; the export is the player's

    val exists get() = file.exists()

    private fun load(): Pair<PrivateKey, X509Certificate> {
        if (!file.exists()) create()
        val ks = KeyStore.getInstance("PKCS12")
        file.inputStream().use { ks.load(it, password) }
        val key = ks.getKey(ALIAS, password) as PrivateKey
        val cert = ks.getCertificate(ALIAS) as X509Certificate
        return key to cert
    }

    fun certificate(): X509Certificate = load().second

    private fun create() {
        val gen = KeyPairGenerator.getInstance("RSA")
        gen.initialize(2048, SecureRandom())
        val pair = gen.generateKeyPair()
        val cert = selfSigned(pair.public.encoded, pair.private)
        val ks = KeyStore.getInstance("PKCS12")
        ks.load(null, null)
        ks.setKeyEntry(ALIAS, pair.private, password, arrayOf(cert))
        val tmp = File(file.path + ".tmp")
        tmp.outputStream().use { ks.store(it, password) }
        tmp.renameTo(file)
    }

    fun export(out: OutputStream) {
        if (!file.exists()) create()
        file.inputStream().use { it.copyTo(out) }
    }

    /** Replaces the key with an exported one (checked first). */
    fun import(input: InputStream) {
        val bytes = input.readBytes()
        val ks = KeyStore.getInstance("PKCS12")
        ks.load(bytes.inputStream(), password)
        require(ks.getKey(ALIAS, password) is PrivateKey) { "not a GGX EN Patcher key file" }
        val tmp = File(file.path + ".tmp")
        tmp.writeBytes(bytes)
        tmp.renameTo(file)
    }

    fun sign(input: File, output: File) {
        val (key, cert) = load()
        val config = ApkSigner.SignerConfig.Builder("ggxen", key, listOf(cert)).build()
        ApkSigner.Builder(listOf(config))
            .setInputApk(input)
            .setOutputApk(output)
            .setMinSdkVersion(24)
            .setV1SigningEnabled(false)
            .setV2SigningEnabled(true)
            .setV3SigningEnabled(true)
            .build()
            .sign()
    }

    companion object {
        private const val ALIAS = "ggxen"

        /** A minimal X.509 v3 certificate (DER), signed with SHA256withRSA by its own key. */
        fun selfSigned(publicKeyInfo: ByteArray, key: PrivateKey): X509Certificate {
            val sha256WithRsa = seq(oid(byteArrayOf(0x2a, 0x86.toByte(), 0x48, 0x86.toByte(), 0xf7.toByte(), 0x0d, 0x01, 0x01, 0x0b)), byteArrayOf(0x05, 0x00))
            val name = seq(set(seq(oid(byteArrayOf(0x55, 0x04, 0x03)), tlv(0x0c, "GGX EN Patch player".toByteArray()))))
            val now = System.currentTimeMillis()
            val validity = seq(time(Date(now - 86_400_000L)), time(Date(now + 30L * 365 * 86_400_000L)))
            val serial = BigInteger(63, SecureRandom()).add(BigInteger.ONE)
            val tbs = seq(
                tlv(0xa0, integer(BigInteger.valueOf(2))),
                integer(serial),
                sha256WithRsa,
                name,
                validity,
                name,
                publicKeyInfo,
            )
            val sig = Signature.getInstance("SHA256withRSA").run {
                initSign(key)
                update(tbs)
                sign()
            }
            val der = seq(tbs, sha256WithRsa, tlv(0x03, byteArrayOf(0) + sig))
            return CertificateFactory.getInstance("X.509").generateCertificate(der.inputStream()) as X509Certificate
        }

        private fun tlv(tag: Int, body: ByteArray): ByteArray {
            val out = ByteArrayOutputStream()
            out.write(tag)
            val n = body.size
            when {
                n < 0x80 -> out.write(n)
                n < 0x100 -> { out.write(0x81); out.write(n) }
                n < 0x10000 -> { out.write(0x82); out.write(n shr 8); out.write(n and 0xff) }
                else -> { out.write(0x83); out.write(n shr 16); out.write((n shr 8) and 0xff); out.write(n and 0xff) }
            }
            out.write(body)
            return out.toByteArray()
        }

        private fun seq(vararg parts: ByteArray) = tlv(0x30, parts.fold(ByteArray(0)) { a, b -> a + b })
        private fun set(vararg parts: ByteArray) = tlv(0x31, parts.fold(ByteArray(0)) { a, b -> a + b })
        private fun oid(body: ByteArray) = tlv(0x06, body)
        private fun integer(v: BigInteger) = tlv(0x02, v.toByteArray())

        private fun time(d: Date): ByteArray {
            val utc = TimeZone.getTimeZone("UTC")
            val year = SimpleDateFormat("yyyy", Locale.US).apply { timeZone = utc }.format(d).toInt()
            return if (year < 2050) tlv(0x17, SimpleDateFormat("yyMMddHHmmss'Z'", Locale.US).apply { timeZone = utc }.format(d).toByteArray())
            else tlv(0x18, SimpleDateFormat("yyyyMMddHHmmss'Z'", Locale.US).apply { timeZone = utc }.format(d).toByteArray())
        }
    }
}
