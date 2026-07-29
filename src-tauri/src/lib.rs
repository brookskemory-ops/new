//! Desktop shell for the Satisfactory Companion.
//!
//! The whole app is the same React bundle the web build serves. Tauri adds a
//! native window plus the dialog and filesystem plugins, which is what lets the
//! desktop build read `Docs.json` straight out of the game folder.

/// Common Satisfactory install locations, newest storefront layouts first.
/// The UI offers these as one-click guesses before falling back to a file picker.
const CANDIDATE_DIRS: &[&str] = &[
    r"C:\Program Files\Epic Games\SatisfactoryEarlyAccess\CommunityResources\Docs",
    r"C:\Program Files\Epic Games\SatisfactoryExperimental\CommunityResources\Docs",
    r"C:\Program Files (x86)\Steam\steamapps\common\Satisfactory\CommunityResources\Docs",
    r"C:\Program Files\Steam\steamapps\common\Satisfactory\CommunityResources\Docs",
    r"D:\SteamLibrary\steamapps\common\Satisfactory\CommunityResources\Docs",
    r"D:\Steam\steamapps\common\Satisfactory\CommunityResources\Docs",
];

/// Localised docs filenames, in the order we would rather have them.
const CANDIDATE_FILES: &[&str] = &["en-US.json", "Docs.json"];

/// Looks for a game docs file in the usual install locations.
///
/// Returns the first path that exists, or `None` so the UI can fall back to
/// asking the player to point at it themselves.
#[tauri::command]
fn find_game_docs() -> Option<String> {
    for dir in CANDIDATE_DIRS {
        for file in CANDIDATE_FILES {
            let path = std::path::Path::new(dir).join(file);
            if path.is_file() {
                return path.to_str().map(str::to_owned);
            }
        }
    }
    None
}

/// Reads a docs file from disk, decoding UTF-16 when the game wrote it that way.
///
/// The game ships these files UTF-16 encoded with a byte order mark, which the
/// browser's own file reader would mangle, so the decoding happens here.
#[tauri::command]
fn read_game_docs(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    decode_docs(&bytes)
}

/// Decodes a docs file, honouring a UTF-16 BOM if present and otherwise
/// assuming UTF-8.
fn decode_docs(bytes: &[u8]) -> Result<String, String> {
    match bytes.get(..2) {
        Some([0xFF, 0xFE]) => Ok(decode_utf16(&bytes[2..], u16::from_le_bytes)),
        Some([0xFE, 0xFF]) => Ok(decode_utf16(&bytes[2..], u16::from_be_bytes)),
        _ => {
            let text = String::from_utf8_lossy(bytes);
            // A UTF-8 BOM would otherwise sit in front of the opening bracket and
            // trip up the JSON parser.
            Ok(text.trim_start_matches('\u{feff}').to_owned())
        }
    }
}

fn decode_utf16(bytes: &[u8], to_unit: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| to_unit([pair[0], pair[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![find_game_docs, read_game_docs])
        .run(tauri::generate_context!())
        .expect("error while running the Satisfactory Companion");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf16_little_endian_with_bom() {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "[{\"a\":1}]".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(decode_docs(&bytes).unwrap(), "[{\"a\":1}]");
    }

    #[test]
    fn decodes_utf16_big_endian_with_bom() {
        let mut bytes = vec![0xFE, 0xFF];
        for unit in "[{\"a\":1}]".encode_utf16() {
            bytes.extend_from_slice(&unit.to_be_bytes());
        }
        assert_eq!(decode_docs(&bytes).unwrap(), "[{\"a\":1}]");
    }

    #[test]
    fn decodes_plain_utf8() {
        assert_eq!(decode_docs(b"[{\"a\":1}]").unwrap(), "[{\"a\":1}]");
    }

    #[test]
    fn strips_a_utf8_byte_order_mark() {
        let bytes = "\u{feff}[{\"a\":1}]".as_bytes();
        assert_eq!(decode_docs(bytes).unwrap(), "[{\"a\":1}]");
    }
}
