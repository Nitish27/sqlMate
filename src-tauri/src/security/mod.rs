use crate::core::ai_credentials::AiProviderId;
use anyhow::{anyhow, Result};
use keyring::{Entry, Error as KeyringError};
use uuid::Uuid;

pub struct SecureStore;

const DATABASE_SERVICE: &str = "com.sqlmate.db";
const SSH_SERVICE: &str = "com.sqlmate.ssh";
const AI_SERVICE: &str = "com.sqlmate.ai";

impl SecureStore {
    fn ai_entry(provider: AiProviderId) -> Result<Entry> {
        Entry::new(AI_SERVICE, provider.as_str()).map_err(|_| anyhow!("OS keychain is unavailable"))
    }

    pub fn get_optional_ai_key(provider: AiProviderId) -> Result<Option<String>> {
        match Self::ai_entry(provider)?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err(anyhow!("Could not read AI key from the OS keychain")),
        }
    }

    pub fn save_ai_key(provider: AiProviderId, key: &str) -> Result<()> {
        Self::ai_entry(provider)?
            .set_password(key)
            .map_err(|_| anyhow!("Could not save AI key to the OS keychain"))
    }

    pub fn delete_ai_key(provider: AiProviderId) -> Result<()> {
        match Self::ai_entry(provider)?.delete_password() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(_) => Err(anyhow!("Could not remove AI key from the OS keychain")),
        }
    }

    fn entry(service: &str, connection_id: &Uuid) -> Result<Entry> {
        Ok(Entry::new(service, &connection_id.to_string())?)
    }

    fn get_optional(service: &str, connection_id: &Uuid) -> Result<Option<String>> {
        match Self::entry(service, connection_id)?.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err(anyhow!("OS keychain is unavailable")),
        }
    }

    pub fn get_optional_password(connection_id: &Uuid) -> Result<Option<String>> {
        Self::get_optional(DATABASE_SERVICE, connection_id)
    }

    pub fn get_optional_ssh_password(connection_id: &Uuid) -> Result<Option<String>> {
        Self::get_optional(SSH_SERVICE, connection_id)
    }

    pub fn save_password(connection_id: &Uuid, password: &str) -> Result<()> {
        let entry = Self::entry(DATABASE_SERVICE, connection_id)?;
        entry
            .set_password(password)
            .map_err(|_| anyhow!("Could not save database password to the OS keychain"))
    }

    pub fn get_password(connection_id: &Uuid) -> Result<String> {
        let entry = Self::entry(DATABASE_SERVICE, connection_id)?;
        entry
            .get_password()
            .map_err(|_| anyhow!("Could not read database password from the OS keychain"))
    }

    pub fn delete_password(connection_id: &Uuid) -> Result<()> {
        Self::delete_optional(DATABASE_SERVICE, connection_id)
    }

    pub fn save_ssh_password(connection_id: &Uuid, password: &str) -> Result<()> {
        Self::entry(SSH_SERVICE, connection_id)?
            .set_password(password)
            .map_err(|_| anyhow!("Could not save SSH password to the OS keychain"))
    }

    pub fn delete_ssh_password(connection_id: &Uuid) -> Result<()> {
        Self::delete_optional(SSH_SERVICE, connection_id)
    }

    fn delete_optional(service: &str, connection_id: &Uuid) -> Result<()> {
        match Self::entry(service, connection_id)?.delete_password() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(_) => Err(anyhow!("Could not remove password from the OS keychain")),
        }
    }
}
