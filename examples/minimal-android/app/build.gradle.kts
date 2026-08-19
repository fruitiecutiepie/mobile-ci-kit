plugins {
    id("com.android.application")
}

android {
    namespace = "dev.mobilecikit.minimal"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.mobilecikit.minimal"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        // Deliberately no minification even in release: this app exists to be driven by Espresso and
        // Appium, and R8 would rename the very identifiers those tests select on.
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
}
