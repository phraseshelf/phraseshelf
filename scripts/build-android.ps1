# Builds an installable (debug-signed) APK for 64-bit ARM phones.
#
# `cargo tauri android build` links the Rust library into the Android project with a
# symlink, which Windows only allows with Developer Mode on. This script copies the
# library instead, so it works either way.
#
# Usage (from anywhere):  powershell -ExecutionPolicy Bypass -File scripts\build-android.ps1
# Output:                 dist\PhraseShelf-<version>-arm64.apk

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$tauri = Join-Path $repo "src-tauri"

foreach ($v in "JAVA_HOME", "ANDROID_HOME", "NDK_HOME") {
    if (-not (Get-Item "env:$v" -ErrorAction SilentlyContinue)) {
        Set-Item "env:$v" ([Environment]::GetEnvironmentVariable($v, "User"))
    }
    if (-not (Get-Item "env:$v").Value) { throw "$v is not set. See README > Android build." }
}

$version = (Get-Content (Join-Path $tauri "tauri.conf.json") -Raw | ConvertFrom-Json).version
Write-Host "Building PhraseShelf $version for Android (arm64)..."

# 1. Compile the Rust library (release). Without Developer Mode this step ends with a
#    symlink error after the library is built; that's expected and handled below.
Push-Location $tauri
$ErrorActionPreference = "Continue"
cargo tauri android build --apk --target aarch64 2>&1 | ForEach-Object { "$_" } |
    Where-Object { $_ -match "Finished|error\[|^error:" } | ForEach-Object { Write-Host $_ }
$ErrorActionPreference = "Stop"
Pop-Location

$so = Join-Path $tauri "target\aarch64-linux-android\release\libphraseshelf_lib.so"
if (-not (Test-Path $so)) { throw "Rust library was not built: $so" }

# 2. Copy it into the Android project.
$jni = Join-Path $tauri "gen\android\app\src\main\jniLibs\arm64-v8a"
New-Item -ItemType Directory -Force $jni | Out-Null
Copy-Item $so $jni -Force

# 3. Package the APK with Gradle, skipping its own Rust step (already done above).
Push-Location (Join-Path $tauri "gen\android")
.\gradlew.bat assembleArm64Debug -x rustBuildArm64Debug --console=plain
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Gradle build failed" }
Pop-Location

$apk = Join-Path $tauri "gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk"
$dist = Join-Path $repo "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
$out = Join-Path $dist "PhraseShelf-$version-arm64.apk"
Copy-Item $apk $out -Force
Write-Host "APK ready: $out ($([math]::Round((Get-Item $out).Length / 1MB, 1)) MB)"
