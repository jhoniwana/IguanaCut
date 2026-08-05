plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.losslesscut.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.losslesscut.app"
        minSdk = 28
        // targetSdk 28 a proposito (== minSdk): con targetSdk >= 29 la app cae
        // en untrusted_app_29/30/32/34, dominios SELinux que DENIEGAN
        // execute_no_trans sobre app_data_file; el server Go/ffmpeg/yt-dlp
        // extraidos a filesDir no pueden ejecutarse (avc denied EACCES).
        // targetSdk 28 -> untrusted_app_27, que conserva execute_no_trans.
        targetSdk = 28
        versionCode = 1
        versionName = "1.0.0"

        ndk {
            abiFilters += listOf("arm64-v8a")
        }
    }

    // Play build (no yt-dlp) vs Enhanced build (yt-dlp bundled, sideload only)
    flavorDimensions += "distribution"
    productFlavors {
        create("play") {
            dimension = "distribution"
            buildConfigField("boolean", "ENABLE_YTDLP", "false")
        }
        create("enhanced") {
            dimension = "distribution"
            buildConfigField("boolean", "ENABLE_YTDLP", "true")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        jniLibs {
            useLegacyPackaging = false
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.kotlinx.coroutines.android)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
