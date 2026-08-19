// Versions are pinned, and pinned to a combination verified to work together rather than to
// "latest" -- an Android build breaks on AGP/Gradle/Kotlin mismatches far more often than on
// anything in the app, and a lane fixture whose build is flaky proves nothing about the lane.
//
// Note there is NO `org.jetbrains.kotlin.android` plugin here. AGP 9.0+ has built-in Kotlin
// support and REJECTS that plugin outright ("no longer required for Kotlin support since AGP
// 9.0"). Copying a pre-AGP-9 template is the fastest way to a confusing failure here.
plugins {
    id("com.android.application") version "9.2.1" apply false
}
