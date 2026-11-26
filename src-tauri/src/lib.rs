use serde_json::Value;

/// Gera G-code com a mesma implementação Rust validada por `rust-anything record/diff`.
#[tauri::command]
fn to_gcode(doc: Value, rig: Option<Value>) -> Result<String, String> {
    toki_core::port::to_gcode(doc, rig)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![to_gcode])
        .run(tauri::generate_context!())
        .expect("error while running TOKI");
}
