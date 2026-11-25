import java.io.File
import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
}

android {
    namespace = "ggxen.patcher"
    compileSdk = 36

    defaultConfig {
        applicationId = "ggxen.patcher"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "0.1.2"
    }

    // Release signing: GGXEN_SIGNING names a properties file (storeFile, storePassword, keyAlias, keyPassword)
    // kept outside the repository. Without it, release builds come out unsigned.
    val signingFile = System.getenv("GGXEN_SIGNING")?.let { File(it) }
    val signing = signingFile?.let { f -> Properties().apply { FileInputStream(f).use { load(it) } } }
    signingConfigs {
        if (signing != null) create("release") {
            // storeFile is relative to the properties file's folder (or absolute)
            storeFile = File(signingFile.parentFile, signing.getProperty("storeFile")).takeIf { it.exists() }
                ?: File(signing.getProperty("storeFile"))
            storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias")
            keyPassword = signing.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (signing != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging {
        // Big binary assets (gadget, agent) are read through AssetManager streams; keep them compressed.
        resources.excludes += setOf("META-INF/LICENSE*", "META-INF/NOTICE*")
    }
}

dependencies {
    implementation("io.github.reandroid:ARSCLib:1.4.0")
    implementation("com.android.tools.build:apksig:9.5.0")
}
