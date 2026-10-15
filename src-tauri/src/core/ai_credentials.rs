use crate::security::SecureStore;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::{fs, io::Write, path::Path};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProviderId {
    Gemini,
    Groq,
    Anthropic,
    Openai,
}

impl AiProviderId {
    pub const ALL: [Self; 4] = [Self::Gemini, Self::Groq, Self::Anthropic, Self::Openai];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Gemini => "gemini",
            Self::Groq => "groq",
            Self::Anthropic => "anthropic",
            Self::Openai => "openai",
        }
    }

    pub fn environment_key(self) -> Option<String> {
        let names: &[&str] = match self {
            Self::Gemini => &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
            Self::Groq => &["GROQ_API_KEY", "YOUR_GROQ_API_KEY"],
            Self::Anthropic => &["ANTHROPIC_API_KEY"],
            Self::Openai => &["OPENAI_API_KEY"],
        };
        names.iter().find_map(|name| {
            std::env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
    }
}

impl FromStr for AiProviderId {
    type Err = &'static str;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value {
            "gemini" => Ok(Self::Gemini),
            "groq" => Ok(Self::Groq),
            "anthropic" => Ok(Self::Anthropic),
            "openai" => Ok(Self::Openai),
            _ => Err("Unknown AI provider"),
        }
    }
}

pub trait AiKeyStore {
    fn get(&self, provider: AiProviderId) -> Result<Option<String>>;
    fn set(&self, provider: AiProviderId, key: &str) -> Result<()>;
    fn delete(&self, provider: AiProviderId) -> Result<()>;
}

pub struct KeychainAiStore;

impl AiKeyStore for KeychainAiStore {
    fn get(&self, provider: AiProviderId) -> Result<Option<String>> {
        SecureStore::get_optional_ai_key(provider)
    }

    fn set(&self, provider: AiProviderId, key: &str) -> Result<()> {
        SecureStore::save_ai_key(provider, key)
    }

    fn delete(&self, provider: AiProviderId) -> Result<()> {
        SecureStore::delete_ai_key(provider)
    }
}

pub fn save_key(store: &impl AiKeyStore, provider: AiProviderId, key: &str) -> Result<()> {
    let key = key.trim();
    anyhow::ensure!(
        !key.is_empty() && key.len() <= 16_384 && !key.bytes().any(|byte| byte.is_ascii_control()),
        "Enter a valid API key"
    );
    store.set(provider, key)
}

#[derive(Debug, Serialize)]
pub struct AiProviderStatus {
    pub provider: AiProviderId,
    pub source: &'static str,
    pub configured: bool,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiSettings {
    pub default_provider: Option<AiProviderId>,
    #[serde(default)]
    pub models: HashMap<AiProviderId, String>,
}

pub fn valid_model_id(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 128
        && model.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'/' | b'.' | b':')
        })
}

pub fn load_ai_settings(path: &Path) -> Result<AiSettings> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AiSettings::default())
        }
        Err(_) => anyhow::bail!("Could not read AI preferences"),
    };
    let settings: AiSettings = serde_json::from_slice(&contents)
        .map_err(|_| anyhow::anyhow!("AI preferences are invalid"))?;
    anyhow::ensure!(
        settings.models.values().all(|model| valid_model_id(model)),
        "AI preferences contain an invalid model ID"
    );
    Ok(settings)
}

pub fn save_ai_settings(path: &Path, settings: &AiSettings) -> Result<()> {
    anyhow::ensure!(
        settings.models.values().all(|model| valid_model_id(model)),
        "Enter a valid model ID"
    );
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| anyhow::anyhow!("Could not create AI preferences directory"))?;
    }
    let contents = serde_json::to_vec_pretty(settings)
        .map_err(|_| anyhow::anyhow!("Could not prepare AI preferences"))?;
    write_private_file(path, &contents)
}

fn write_private_file(path: &Path, contents: &[u8]) -> Result<()> {
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<()> {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| anyhow::anyhow!("Could not update AI preferences"))?;
        file.write_all(contents)
            .and_then(|_| file.sync_all())
            .map_err(|_| anyhow::anyhow!("Could not write AI preferences"))?;
        drop(file);
        fs::rename(&temporary, path)
            .map_err(|_| anyhow::anyhow!("Could not replace AI preferences"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub fn resolve_key(
    store: &impl AiKeyStore,
    provider: AiProviderId,
    environment_key: Option<&str>,
) -> Result<Option<String>> {
    Ok(store
        .get(provider)?
        .filter(|key| !key.trim().is_empty())
        .or_else(|| {
            environment_key
                .filter(|key| !key.trim().is_empty())
                .map(str::to_owned)
        }))
}

pub fn provider_status(
    store: &impl AiKeyStore,
    provider: AiProviderId,
    environment_configured: bool,
) -> Result<AiProviderStatus> {
    let source = if store
        .get(provider)?
        .is_some_and(|key| !key.trim().is_empty())
    {
        "keychain"
    } else if environment_configured {
        "environment"
    } else {
        "missing"
    };
    Ok(AiProviderStatus {
        provider,
        source,
        configured: source != "missing",
    })
}

pub fn migrate_legacy_groq_key(store: &impl AiKeyStore, path: &Path) -> Result<bool> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => anyhow::bail!("Could not read legacy AI configuration"),
    };
    let mut config: serde_json::Value = serde_json::from_slice(&contents)
        .map_err(|_| anyhow::anyhow!("Legacy AI configuration is invalid"))?;
    let Some(key) = config
        .get("groq_api_key")
        .and_then(serde_json::Value::as_str)
        .filter(|key| !key.trim().is_empty())
        .map(|key| key.trim().to_owned())
    else {
        return Ok(false);
    };

    if store.get(AiProviderId::Groq)?.is_none() {
        save_key(store, AiProviderId::Groq, &key)?;
        anyhow::ensure!(
            store.get(AiProviderId::Groq)?.as_deref() == Some(key.as_str()),
            "Could not verify migrated AI key in the OS keychain"
        );
    }

    config
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("Legacy AI configuration is invalid"))?
        .remove("groq_api_key");
    let updated = serde_json::to_vec_pretty(&config)
        .map_err(|_| anyhow::anyhow!("Could not prepare legacy AI configuration"))?;
    write_private_file(path, &updated)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemoryStore(std::sync::Mutex<HashMap<AiProviderId, String>>);

    impl AiKeyStore for MemoryStore {
        fn get(&self, provider: AiProviderId) -> anyhow::Result<Option<String>> {
            Ok(self.0.lock().unwrap().get(&provider).cloned())
        }

        fn set(&self, provider: AiProviderId, key: &str) -> anyhow::Result<()> {
            self.0.lock().unwrap().insert(provider, key.to_owned());
            Ok(())
        }

        fn delete(&self, provider: AiProviderId) -> anyhow::Result<()> {
            self.0.lock().unwrap().remove(&provider);
            Ok(())
        }
    }

    #[test]
    fn only_four_known_provider_ids_are_accepted() {
        for name in ["gemini", "groq", "anthropic", "openai"] {
            assert!(name.parse::<AiProviderId>().is_ok());
        }
        assert!("../../secret".parse::<AiProviderId>().is_err());
    }

    #[test]
    fn keychain_key_wins_over_environment_without_exposing_the_key_in_status() {
        let store = MemoryStore::default();
        store.set(AiProviderId::Groq, "private-key").unwrap();
        let key = resolve_key(&store, AiProviderId::Groq, Some("environment-key")).unwrap();
        assert_eq!(key.as_deref(), Some("private-key"));
        let status = provider_status(&store, AiProviderId::Groq, true).unwrap();
        let serialized = serde_json::to_string(&status).unwrap();
        assert!(serialized.contains("keychain"));
        assert!(!serialized.contains("private-key"));
    }

    #[test]
    fn environment_key_is_used_when_no_keychain_key_exists() {
        let store = MemoryStore::default();
        assert_eq!(
            resolve_key(&store, AiProviderId::Gemini, Some("environment-key"))
                .unwrap()
                .as_deref(),
            Some("environment-key")
        );
        let status = provider_status(&store, AiProviderId::Gemini, true).unwrap();
        assert_eq!(status.source, "environment");
        assert!(!serde_json::to_string(&status)
            .unwrap()
            .contains("environment-key"));
        assert_eq!(
            provider_status(&store, AiProviderId::Openai, false)
                .unwrap()
                .source,
            "missing"
        );
    }

    #[test]
    fn saved_key_can_be_deleted_without_affecting_other_providers() {
        let store = MemoryStore::default();
        save_key(&store, AiProviderId::Groq, "groq-key").unwrap();
        save_key(&store, AiProviderId::Openai, "openai-key").unwrap();
        store.delete(AiProviderId::Groq).unwrap();
        assert!(store.get(AiProviderId::Groq).unwrap().is_none());
        assert_eq!(
            store.get(AiProviderId::Openai).unwrap().as_deref(),
            Some("openai-key")
        );
    }

    #[test]
    fn blank_keys_are_rejected_before_storage() {
        let store = MemoryStore::default();
        assert!(save_key(&store, AiProviderId::Openai, "  ").is_err());
        assert!(save_key(&store, AiProviderId::Openai, "key\nInjected: yes").is_err());
        assert!(store.get(AiProviderId::Openai).unwrap().is_none());
    }

    #[test]
    fn keychain_errors_do_not_silently_select_an_environment_key() {
        struct FailingStore;
        impl AiKeyStore for FailingStore {
            fn get(&self, _: AiProviderId) -> anyhow::Result<Option<String>> {
                anyhow::bail!("OS keychain is unavailable")
            }
            fn set(&self, _: AiProviderId, _: &str) -> anyhow::Result<()> {
                anyhow::bail!("OS keychain is unavailable")
            }
            fn delete(&self, _: AiProviderId) -> anyhow::Result<()> {
                anyhow::bail!("OS keychain is unavailable")
            }
        }
        assert!(resolve_key(&FailingStore, AiProviderId::Groq, Some("env-key")).is_err());
    }

    #[test]
    fn legacy_groq_key_is_removed_only_after_verified_keychain_storage() {
        let path = std::env::temp_dir().join(format!("sqlmate-ai-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&path, r#"{"groq_api_key":"old-key","theme":"dark"}"#).unwrap();
        let store = MemoryStore::default();

        assert!(migrate_legacy_groq_key(&store, &path).unwrap());
        assert_eq!(
            store.get(AiProviderId::Groq).unwrap().as_deref(),
            Some("old-key")
        );
        let updated: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(updated.get("groq_api_key").is_none());
        assert_eq!(updated["theme"], "dark");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn legacy_groq_key_with_surrounding_whitespace_migrates_cleanly() {
        let path = std::env::temp_dir().join(format!("sqlmate-ai-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&path, r#"{"groq_api_key":" old-key "}"#).unwrap();
        let store = MemoryStore::default();

        assert!(migrate_legacy_groq_key(&store, &path).unwrap());
        assert_eq!(
            store.get(AiProviderId::Groq).unwrap().as_deref(),
            Some("old-key")
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn legacy_migration_does_not_replace_a_newer_keychain_key() {
        let path = std::env::temp_dir().join(format!("sqlmate-ai-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&path, r#"{"groq_api_key":"old-key"}"#).unwrap();
        let store = MemoryStore::default();
        store.set(AiProviderId::Groq, "new-key").unwrap();

        assert!(migrate_legacy_groq_key(&store, &path).unwrap());
        assert_eq!(
            store.get(AiProviderId::Groq).unwrap().as_deref(),
            Some("new-key")
        );
        assert!(!std::fs::read_to_string(&path)
            .unwrap()
            .contains("old-key"));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn failed_legacy_migration_keeps_the_original_file() {
        struct NoWrites;
        impl AiKeyStore for NoWrites {
            fn get(&self, _: AiProviderId) -> anyhow::Result<Option<String>> {
                Ok(None)
            }
            fn set(&self, _: AiProviderId, _: &str) -> anyhow::Result<()> {
                anyhow::bail!("OS keychain is unavailable")
            }
            fn delete(&self, _: AiProviderId) -> anyhow::Result<()> {
                Ok(())
            }
        }
        let path = std::env::temp_dir().join(format!("sqlmate-ai-{}.json", uuid::Uuid::new_v4()));
        let original = r#"{"groq_api_key":"old-key","theme":"dark"}"#;
        std::fs::write(&path, original).unwrap();

        assert!(migrate_legacy_groq_key(&NoWrites, &path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn nonsecret_provider_preferences_round_trip() {
        let path = std::env::temp_dir().join(format!("sqlmate-ai-{}.json", uuid::Uuid::new_v4()));
        let mut settings = AiSettings::default();
        settings.default_provider = Some(AiProviderId::Anthropic);
        settings
            .models
            .insert(AiProviderId::Anthropic, "claude-test-model".into());

        save_ai_settings(&path, &settings).unwrap();
        assert_eq!(load_ai_settings(&path).unwrap(), settings);
        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(!contents.contains("api_key"));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn model_id_validation_rejects_header_and_payload_injection() {
        assert!(valid_model_id("openai/gpt-oss-120b"));
        assert!(!valid_model_id("bad\nAuthorization: secret"));
        assert!(!valid_model_id(""));
    }
}
