use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

static DRAFT_LOCK: Mutex<()> = Mutex::new(());
static DRAFT_KEY: Mutex<Option<[u8; 32]>> = Mutex::new(None);
const KEY_SERVICE: &str = "com.sqlmate.row-drafts";
const KEY_ACCOUNT: &str = "master-key-v1";
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct EncryptedDrafts {
    version: u8,
    nonce: String,
    ciphertext: String,
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    if value.len() % 2 != 0 {
        return Err("Invalid encrypted draft encoding".into());
    }
    (0..value.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&value[i..i + 2], 16)
                .map_err(|_| "Invalid encrypted draft encoding".into())
        })
        .collect()
}

fn encrypt(key: &[u8; 32], drafts: &HashMap<String, Value>) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid draft key")?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let plaintext = serde_json::to_vec(drafts).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_ref())
        .map_err(|_| "Could not encrypt drafts")?;
    serde_json::to_vec(&EncryptedDrafts {
        version: 1,
        nonce: encode_hex(&nonce),
        ciphertext: encode_hex(&ciphertext),
    })
    .map_err(|e| e.to_string())
}

fn decrypt(key: &[u8; 32], data: &[u8]) -> Result<HashMap<String, Value>, String> {
    let envelope: EncryptedDrafts =
        serde_json::from_slice(data).map_err(|_| "Invalid draft file")?;
    if envelope.version != 1 {
        return Err("Unsupported draft file version".into());
    }
    let nonce = decode_hex(&envelope.nonce)?;
    let nonce: &[u8; 12] = nonce
        .as_slice()
        .try_into()
        .map_err(|_| "Invalid draft nonce")?;
    let ciphertext = decode_hex(&envelope.ciphertext)?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid draft key")?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext.as_ref())
        .map_err(|_| "Could not decrypt drafts. Check the OS keychain.")?;
    serde_json::from_slice(&plaintext).map_err(|_| "Invalid draft contents".into())
}

fn draft_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("row-drafts.enc"))
}

fn key(existing_file: bool) -> Result<[u8; 32], String> {
    let mut cached = DRAFT_KEY.lock().map_err(|_| "Draft key unavailable")?;
    if let Some(key) = *cached {
        return Ok(key);
    }
    let entry = Entry::new(KEY_SERVICE, KEY_ACCOUNT).map_err(|_| "OS keychain unavailable")?;
    let result: Result<[u8; 32], String> = match entry.get_password() {
        Ok(value) => decode_hex(&value)?
            .try_into()
            .map_err(|_| "Invalid draft key".into()),
        Err(KeyringError::NoEntry) if !existing_file => {
            let mut key = [0u8; 32];
            use aes_gcm::aead::rand_core::RngCore;
            OsRng.fill_bytes(&mut key);
            entry
                .set_password(&encode_hex(&key))
                .map_err(|_| "OS keychain unavailable")?;
            Ok(key)
        }
        Err(KeyringError::NoEntry) => {
            Err("Draft encryption key is missing from the OS keychain".into())
        }
        Err(_) => Err("OS keychain unavailable".into()),
    };
    let result = result?;
    *cached = Some(result);
    Ok(result)
}

fn read(path: &Path) -> Result<HashMap<String, Value>, String> {
    #[cfg(windows)]
    let source = if path.exists() {
        path.to_path_buf()
    } else {
        path.with_extension("bak")
    };
    #[cfg(not(windows))]
    let source = path.to_path_buf();
    if !source.exists() {
        return Ok(HashMap::new());
    }
    if fs::metadata(&source).map_err(|e| e.to_string())?.len() > MAX_FILE_BYTES {
        return Err("Draft file is too large".into());
    }
    let secret = key(true)?;
    decrypt(&secret, &fs::read(source).map_err(|e| e.to_string())?)
}

fn write(path: &Path, drafts: &HashMap<String, Value>) -> Result<(), String> {
    #[cfg(windows)]
    let existing_file = path.exists() || path.with_extension("bak").exists();
    #[cfg(not(windows))]
    let existing_file = path.exists();
    let secret = key(existing_file)?;
    let encrypted = encrypt(&secret, drafts)?;
    if encrypted.len() as u64 > MAX_FILE_BYTES {
        return Err("Draft file is too large".into());
    }
    fs::create_dir_all(path.parent().ok_or("Invalid draft path")?).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    fs::write(&temp, encrypted).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    {
        let backup = path.with_extension("bak");
        if path.exists() {
            if backup.exists() {
                fs::remove_file(&backup).map_err(|e| e.to_string())?;
            }
            fs::rename(path, &backup).map_err(|e| e.to_string())?;
        }
        if let Err(error) = fs::rename(&temp, path) {
            if backup.exists() {
                let _ = fs::rename(&backup, path);
            }
            let _ = fs::remove_file(&temp);
            return Err(error.to_string());
        }
        if backup.exists() {
            let _ = fs::remove_file(backup);
        }
    }
    #[cfg(not(windows))]
    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(error.to_string());
    }
    Ok(())
}

fn validate_context(context: &str) -> Result<(), String> {
    if context.is_empty() || context.len() > 2048 {
        return Err("Invalid draft context".into());
    }
    Ok(())
}

#[tauri::command]
pub fn load_row_draft(app: AppHandle, context: String) -> Result<Option<Value>, String> {
    validate_context(&context)?;
    let _guard = DRAFT_LOCK.lock().map_err(|_| "Draft store unavailable")?;
    Ok(read(&draft_path(&app)?)?.remove(&context))
}

#[tauri::command]
pub fn save_row_draft(app: AppHandle, context: String, draft: Value) -> Result<(), String> {
    validate_context(&context)?;
    let _guard = DRAFT_LOCK.lock().map_err(|_| "Draft store unavailable")?;
    let path = draft_path(&app)?;
    let mut drafts = read(&path)?;
    drafts.insert(context, draft);
    write(&path, &drafts)
}

#[tauri::command]
pub fn delete_row_draft(app: AppHandle, context: String) -> Result<(), String> {
    validate_context(&context)?;
    let _guard = DRAFT_LOCK.lock().map_err(|_| "Draft store unavailable")?;
    let path = draft_path(&app)?;
    let mut drafts = read(&path)?;
    if drafts.remove(&context).is_some() {
        write(&path, &drafts)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_drafts_round_trip_and_detect_tampering() {
        let key = [7u8; 32];
        let drafts = HashMap::from([(
            "connection/table".into(),
            serde_json::json!({"password": "secret"}),
        )]);
        let data = encrypt(&key, &drafts).unwrap();
        assert!(!String::from_utf8_lossy(&data).contains("secret"));
        assert_eq!(decrypt(&key, &data).unwrap(), drafts);
        assert!(decrypt(&[8u8; 32], &data).is_err());
        let mut envelope: EncryptedDrafts = serde_json::from_slice(&data).unwrap();
        envelope.ciphertext.replace_range(0..2, "ff");
        assert!(decrypt(&key, &serde_json::to_vec(&envelope).unwrap()).is_err());
    }
}
