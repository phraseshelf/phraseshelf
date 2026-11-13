# PhraseShelf

A small Windows and Android app that holds tabs of labeled buttons. Click a button and its content is copied to the clipboard. It's handy for phrases you can't easily type (Korean, emoji, symbols), canned replies, addresses, and code snippets.

Built with [Tauri 2](https://tauri.app). The Rust backend (`src-tauri/`) handles saving data and the clipboard, and the UI (`ui/`) is plain HTML/CSS/JS with no build step.

## Using it

| Do this | How |
|---|---|
| Copy | Click a button |
| Add a button | **+ Add button** card, or `Ctrl+N` |
| Edit / delete a button | Hover and click **✎**, or right-click it |
| Add a tab | **+** next to the tabs |
| Rename / delete a tab | Double-click or right-click the tab |
| Reorder | Drag buttons or tabs; drop a button on another tab to move it there |
| Filter | `Ctrl+F`, then `Enter` copies the first match, `Esc` clears |
| Switch tabs | `Ctrl+1` … `Ctrl+9` |
| Change a tab's color | Double-click the tab, pick a swatch |
| Export | **Export tab…** in a tab's dialog, or **Export all…** (saves `.json`) |
| Import | **Import…** accepts a `.json` export or a `.txt` list (see below). Imported tabs are always added as new tabs and never overwrite existing ones |

### System tray

Closing the window hides it to the tray. Left-click the tray icon to show or hide it, and right-click it for **Quit**. Starting the app again while it's running just brings the existing window forward.

### Text list import

A plain UTF-8 `.txt` file with one button per line becomes a tab named after the file. Lines without `->` are ignored.

```
Hello -> 안녕하세요
Good work -> 수고하셨습니다
```

## Android

The same app runs on Android:
- Tap a button to copy it. Long-press a button or tab (or tap ✎) to edit it.
- To move a button to another tab, use the **Tab** picker in its editor. Drag-and-drop is mouse-only.
- Each device keeps its own data. To copy everything across, use **Export all** on one device and **Import** on the other.

## Installing

Run `PhraseShelf_<version>_x64-setup.exe`. It installs for your Windows account only (no admin needed) and adds a Start menu entry. Uninstall it from Windows Settings → Apps. Your data in `%APPDATA%` is kept.

## Where your data lives

`%APPDATA%\app.phraseshelf\data.json` is plain JSON, so you can back it up or edit it by hand. The previous version is kept beside it as `data.json.bak` on every save.

## Releases and updates

Pushing a version tag (e.g. `v0.6.0`) runs [`.github/workflows/release.yml`](.github/workflows/release.yml). It builds:
- the Windows installer
- Linux packages (`.deb`, `.rpm`, `.AppImage`)
- a signed Android APK

Everything goes into a **draft** GitHub Release, which you review and then publish.

The Windows and Linux (AppImage) apps check the latest release on startup and offer to update. Updates are signed, and the app only installs ones that match the public key in `tauri.conf.json`. You can also click the version number in the footer to check for updates.

## Building

Prerequisites: [Rust](https://rustup.rs) and the Visual Studio C++ Build Tools ("Desktop development with C++"). WebView2 ships with Windows 11.

```powershell
cd src-tauri
cargo run              # debug build, launches the app
cargo build --release  # standalone exe at src-tauri\target\release\phraseshelf.exe
```

For quick UI tweaks without rebuilding, run `python -m http.server 8765` in the repo root and open `http://localhost:8765/dev/preview.html`. It loads `ui/` with a fake backend and sample tabs; nothing is saved.

### Android build

Prerequisites:
- JDK 17, with `JAVA_HOME` set
- The Android SDK, with `ANDROID_HOME` set
- An Android NDK, with `NDK_HOME` set
- The Rust Android targets: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-android.ps1
```

The APK is written to `dist\PhraseShelf-<version>-arm64.apk`. The script works around Windows' symlink restriction. If Windows Developer Mode is on, plain `cargo tauri android build --apk --target aarch64` in `src-tauri` also works, but it produces an unsigned APK that has to be signed before it can be installed. To install it, copy it to the phone and open it (allow "install unknown apps"), or use `adb install <apk>`.

### Windows installer

To build the installer, install the Tauri CLI once with `cargo install tauri-cli --version "^2" --locked`. Then run `cargo tauri build` in `src-tauri`. The installer is written to `src-tauri\target\release\bundle\nsis\`.
