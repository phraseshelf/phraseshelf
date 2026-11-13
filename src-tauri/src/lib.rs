//! PhraseShelf: shared app code for Windows (desktop) and Android (mobile).
//! Desktop-only parts (tray, single instance, hide-on-close) are behind `#[cfg(desktop)]`.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_fs::{FsExt, OpenOptions};

/// One copy button: a label and the text it puts on the clipboard.
#[derive(Serialize, Deserialize, Clone)]
struct Snippet {
    id: String,
    title: String,
    content: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct Tab {
    id: String,
    name: String,
    /// CSS color for the tab chip, e.g. "#3b6fd9". None = pick from the palette by position.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(default)]
    snippets: Vec<Snippet>,
}

/// Everything the app stores, saved as one JSON file.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Data {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    tabs: Vec<Tab>,
    #[serde(default)]
    active_tab: Option<String>,
    /// "light" | "dark"; None = follow the system.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    theme: Option<String>,
}

fn default_version() -> u32 {
    1
}

/// Starter content shown the first time the app runs.
fn seed() -> Data {
    let s = |id: &str, title: &str, content: &str| Snippet {
        id: id.into(),
        title: title.into(),
        content: content.into(),
    };
    Data {
        version: 1,
        active_tab: Some("korean".into()),
        theme: None,
        tabs: vec![Tab {
            id: "korean".into(),
            name: "Korean Phrases".into(),
            color: Some("#3b6fd9".into()),
            snippets: vec![
                s("hello", "Hello", "안녕하세요"),
                s("good-work", "Good work", "수고하셨습니다"),
                s("thank-you", "Thank you", "감사합니다"),
            ],
        }],
    }
}

// ---------- storage ----------

/// Windows: %APPDATA%\app.phraseshelf\data.json
/// Android: the app's private data folder.
fn data_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir.join("data.json"))
}

/// Write to a temp file first, then swap it in, so a crash mid-save can't
/// leave a half-written data file. The previous version is kept as data.json.bak.
fn write_data(path: &PathBuf, data: &Data) -> Result<(), String> {
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    if path.exists() {
        let _ = fs::copy(path, path.with_extension("json.bak"));
    }
    fs::rename(&tmp, path).map_err(|e| format!("Could not save {}: {e}", path.display()))
}

#[tauri::command]
fn load_data(app: AppHandle) -> Result<Data, String> {
    let path = data_file(&app)?;
    if !path.exists() {
        let data = seed();
        write_data(&path, &data)?;
        return Ok(data);
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    // On a parse error we refuse to load rather than overwrite the user's file.
    serde_json::from_str(&text)
        .map_err(|e| format!("{} is not valid ({e}). Fix or remove it and restart.", path.display()))
}

#[tauri::command]
fn save_data(app: AppHandle, data: Data) -> Result<(), String> {
    write_data(&data_file(&app)?, &data)
}

#[tauri::command]
fn data_path(app: AppHandle) -> Result<String, String> {
    Ok(data_file(&app)?.display().to_string())
}

#[tauri::command]
fn copy_text(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("Clipboard error: {e}"))
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn platform() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else {
        "desktop"
    }
}

/// Match the native title bar to the app theme. "light"/"dark", anything else = follow the system.
#[tauri::command]
fn set_theme(window: tauri::WebviewWindow, theme: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let t = match theme.as_str() {
            "light" => Some(tauri::Theme::Light),
            "dark" => Some(tauri::Theme::Dark),
            _ => None,
        };
        window.set_theme(t).map_err(|e| e.to_string())
    }
    #[cfg(mobile)]
    {
        let _ = (window, theme);
        Ok(())
    }
}

// ---------- updates (desktop) ----------

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

/// Asks the release feed whether a newer version exists. None = up to date (or mobile).
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let update = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?;
        Ok(update.map(|u| UpdateInfo {
            version: u.version.clone(),
            notes: u.body.clone(),
        }))
    }
    #[cfg(mobile)]
    {
        let _ = app;
        Ok(None)
    }
}

/// Downloads the update, verifies its signature against the public key in
/// tauri.conf.json, installs it and restarts the app.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let Some(update) = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?
        else {
            return Ok(());
        };
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    #[cfg(mobile)]
    {
        let _ = app;
        Ok(())
    }
}

// ---------- import / export ----------

#[derive(Serialize)]
struct ImportFile {
    /// File name without extension; used as the tab name for .txt imports.
    name: String,
    text: String,
}

/// Best-effort file name (no extension) for a picked file. On Android the picker
/// returns a content:// URL whose last segment is usually "primary:Download/Name.txt".
fn display_stem(path: &FilePath) -> String {
    let raw = match path {
        FilePath::Path(p) => p.file_name().map(|s| s.to_string_lossy().into_owned()),
        FilePath::Url(u) => u.path_segments().and_then(|mut s| s.next_back()).map(percent_decode),
    }
    .unwrap_or_default();
    let base = raw.rsplit(['/', ':']).next().unwrap_or("");
    let stem = match base.rfind('.') {
        Some(i) if i > 0 => &base[..i],
        _ => base,
    };
    if stem.trim().is_empty() {
        "Imported".into()
    } else {
        stem.trim().into()
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("");
            if let Ok(v) = u8::from_str_radix(hex, 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// These are async so they run off the main thread; the blocking file dialogs
// would otherwise freeze the window.
#[tauri::command]
async fn pick_import_file(app: AppHandle) -> Result<Option<ImportFile>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Import tabs")
        .add_filter("PhraseShelf export or text list", &["json", "txt"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let name = display_stem(&picked);
    let mut opts = OpenOptions::new();
    opts.read(true);
    let mut text = String::new();
    app.fs()
        .open(picked, opts)
        .and_then(|mut f| f.read_to_string(&mut text))
        .map_err(|e| format!("Could not read that file (is it UTF-8 text?): {e}"))?;
    Ok(Some(ImportFile { name, text }))
}

#[tauri::command]
async fn save_export(app: AppHandle, file_name: String, contents: String) -> Result<Option<String>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Export tabs")
        .set_file_name(&file_name)
        .add_filter("PhraseShelf export", &["json"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let shown = match &picked {
        FilePath::Path(p) => p.display().to_string(),
        FilePath::Url(_) => file_name.clone(),
    };
    let mut opts = OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    app.fs()
        .open(picked, opts)
        .and_then(|mut f| f.write_all(contents.as_bytes()))
        .map_err(|e| format!("Could not write {shown}: {e}"))?;
    Ok(Some(shown))
}

// ---------- desktop: window & tray ----------

#[cfg(desktop)]
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(desktop)]
fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
        if visible {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

#[cfg(desktop)]
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let show = MenuItem::with_id(app, "show", "Show PhraseShelf", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("app icon missing"))
        .tooltip("PhraseShelf")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

// ---------- entry point ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Must be registered first: a second launch just focuses the running copy.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)));

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|_app| {
            #[cfg(desktop)]
            build_tray(_app)?;
            Ok(())
        });

    // Desktop: closing the window hides it to the tray; use the tray menu's Quit to exit.
    #[cfg(desktop)]
    let builder = builder.on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
        }
    });

    builder
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            data_path,
            copy_text,
            pick_import_file,
            save_export,
            app_version,
            platform,
            set_theme,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running PhraseShelf");
}
