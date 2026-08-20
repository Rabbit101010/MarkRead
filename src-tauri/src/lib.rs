use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::menu::{IsMenuItem, Menu, MenuItem, MenuEvent, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_recent(app: AppHandle, path: String) {
    let file = recent_path(&app);
    let mut list = load_recent(&file);
    list.retain(|p| p != &path);
    list.insert(0, path);
    list.truncate(10);
    if let Ok(json) = serde_json::to_string(&list) {
        if let Some(parent) = file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&file, json);
    }
    // Rebuild the menu so "最近打开" reflects the new entry.
    if let Err(e) = build_menu(&app) {
        eprintln!("rebuild menu failed: {e}");
    }
}

fn recent_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|d| d.join("recent.json"))
        .unwrap_or_else(|_| PathBuf::from("recent.json"))
}

// File-open requests delivered by Finder / "Open with" are handled in two
// stages: a Rust event (RunEvent::Opened) and a front-end that may not be
// loaded yet (cold start). We park incoming paths in process-global storage
// (NOT Tauri State, because macOS can dispatch Opened before setup completes)
// and flush them once the renderer signals readiness via `mark_ready`.
static PENDING: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
static READY: OnceLock<Mutex<bool>> = OnceLock::new();

fn pending_store() -> &'static Mutex<Vec<String>> {
    PENDING.get_or_init(|| Mutex::new(Vec::new()))
}
fn ready_store() -> &'static Mutex<bool> {
    READY.get_or_init(|| Mutex::new(false))
}

#[tauri::command]
fn mark_ready(app: AppHandle) {
    let paths: Vec<String> = {
        let mut pend = pending_store().lock().unwrap();
        std::mem::take(&mut *pend)
    };
    *ready_store().lock().unwrap() = true;
    for p in paths {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.emit("open-file", &p);
        }
    }
}

fn load_recent(file: &Path) -> Vec<String> {
    fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[derive(Serialize, Clone)]
struct MenuMsg {
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    arg: Option<String>,
}

pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
        read_file,
        write_file,
        write_file_bytes,
        add_recent,
        mark_ready
    ]);

    builder = builder.on_menu_event(|app, event| {
        handle_menu_event(app, event);
    });

    let app = builder
        .setup(|app| {
            build_menu(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // File-association / "Open with" handling. `RunEvent::Opened` is only
        // available on macOS in the current Tauri version; on Windows/Linux we
        // ignore the event so the build stays portable (Windows file
        // association via argv / deep-link is a follow-up).
        #[cfg(target_os = "macos")]
        {
            if let RunEvent::Opened { urls } = event {
                let ready = *ready_store().lock().unwrap();
                let mut collected: Vec<String> = Vec::new();
                {
                    let mut pend = pending_store().lock().unwrap();
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            let p = path.to_string_lossy().to_string();
                            if ready {
                                collected.push(p);
                            } else {
                                pend.push(p);
                            }
                        }
                    }
                }
                if ready {
                    for p in collected {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.emit("open-file", &p);
                        }
                    }
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}

pub fn build_menu(app: &AppHandle) -> tauri::Result<()> {
    let recent = load_recent(&recent_path(app));

    let open = MenuItem::with_id(app, "open", "打开…", true, Some("Cmd+O"))?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let save = MenuItem::with_id(app, "save", "保存", true, Some("Cmd+S"))?;
    let save_as = MenuItem::with_id(app, "save-as", "另存为…", true, Some("Cmd+Shift+S"))?;
    let export_pdf = MenuItem::with_id(app, "export-pdf", "导出为 PDF…", true, Some("Cmd+Shift+P"))?;
    let export_word = MenuItem::with_id(app, "export-word", "导出为 Word…", true, Some("Cmd+Shift+W"))?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let close = PredefinedMenuItem::close_window(app, None)?;

    // Build the 文件 (File) submenu, injecting the recent list.
    let recent_item: Box<dyn IsMenuItem<tauri::Wry>> = if recent.is_empty() {
        Box::new(MenuItem::with_id(app, "recent-none", "（暂无）", false, None::<&str>)?)
    } else {
        let mut boxes: Vec<Box<dyn IsMenuItem<tauri::Wry>>> = vec![];
        for p in &recent {
            let name = Path::new(p)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.clone());
            let item = MenuItem::with_id(app, format!("recent::{p}"), name, true, None::<&str>)?;
            boxes.push(Box::new(item));
        }
        let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = boxes.iter().map(|b| b.as_ref()).collect();
        Box::new(Submenu::with_items(app, "最近打开", true, &refs)?)
    };

    let file_items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![
        &open, &sep1, &save, &save_as, &export_pdf, &export_word, &sep2, &*recent_item, &close,
    ];
    let file_sub = Submenu::with_items(app, "文件", true, &file_items)?;

    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let sep4 = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit_sub = Submenu::with_items(
        app,
        "编辑",
        true,
        &[&undo, &redo, &sep4, &cut, &copy, &paste, &select_all],
    )?;

    let zoom_in = MenuItem::with_id(app, "zoom-in", "字体放大", true, Some("Cmd+="))?;
    let zoom_out = MenuItem::with_id(app, "zoom-out", "字体缩小", true, Some("Cmd+-"))?;
    let zoom_reset = MenuItem::with_id(app, "zoom-reset", "重置字体", true, Some("Cmd+0"))?;
    let sep5 = PredefinedMenuItem::separator(app)?;
    let theme = MenuItem::with_id(app, "toggle-theme", "切换主题", true, Some("Cmd+T"))?;
    let toc = MenuItem::with_id(app, "toggle-toc", "切换目录", true, Some("Cmd+\\"))?;
    let sep6 = PredefinedMenuItem::separator(app)?;
    let mode_read = MenuItem::with_id(app, "mode-read", "阅读模式", true, None::<&str>)?;
    let mode_split = MenuItem::with_id(app, "mode-split", "双栏模式", true, None::<&str>)?;
    let mode_edit = MenuItem::with_id(app, "mode-edit", "编辑模式", true, Some("Cmd+E"))?;
    let view_sub = Submenu::with_items(
        app,
        "视图",
        true,
        &[
            &zoom_in, &zoom_out, &zoom_reset, &sep5, &theme, &toc, &sep6, &mode_read, &mode_split,
            &mode_edit,
        ],
    )?;

    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let sep7 = PredefinedMenuItem::separator(app)?;
    let close_w = PredefinedMenuItem::close_window(app, None)?;
    let window_sub = Submenu::with_items(app, "窗口", true, &[&minimize, &sep7, &close_w])?;

    let show_help = MenuItem::with_id(app, "show-help", "使用说明", true, None::<&str>)?;
    let about = PredefinedMenuItem::about(app, None, None)?;
    let help_sub = Submenu::with_items(app, "帮助", true, &[&show_help, &about])?;

    let menu = Menu::with_items(
        app,
        &[&file_sub, &edit_sub, &view_sub, &window_sub, &help_sub],
    )?;

    app.set_menu(menu).map(|_| ())
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref().to_string();
    let (action, arg): (String, Option<String>) = if let Some(p) = id.strip_prefix("recent::") {
        ("recent".to_string(), Some(p.to_string()))
    } else {
        match id.as_str() {
            "open" => ("open".into(), None),
            "save" => ("save".into(), None),
            "save-as" => ("save-as".into(), None),
            "export-pdf" => ("export-pdf".into(), None),
            "export-word" => ("export-word".into(), None),
            "zoom-in" => ("zoom".into(), Some("in".into())),
            "zoom-out" => ("zoom".into(), Some("out".into())),
            "zoom-reset" => ("zoom".into(), Some("reset".into())),
            "toggle-theme" => ("toggle-theme".into(), None),
            "toggle-toc" => ("toggle-toc".into(), None),
            "mode-read" => ("set-mode".into(), Some("read".into())),
            "mode-split" => ("set-mode".into(), Some("split".into())),
            "mode-edit" => ("set-mode".into(), Some("edit".into())),
            "show-help" => ("show-help".into(), None),
            _ => return,
        }
    };
    emit_menu(app, &action, arg);
}

fn emit_menu(app: &AppHandle, action: &str, arg: Option<String>) {
    if let Some(w) = app.get_webview_window("main") {
        let msg = MenuMsg {
            action: action.to_string(),
            arg,
        };
        let _ = w.emit("menu", msg);
    }
}
