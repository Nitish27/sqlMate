use keyring::Entry;
use anyhow::{Result, anyhow};
use uuid::Uuid;

pub struct SecureStore;

impl SecureStore {
    pub fn save_password(connection_id: &Uuid, password: &str) -> Result<()> {
        let entry = Entry::new("com.sqlmate.db", &connection_id.to_string())?;
        entry.set_password(password).map_err(|e| anyhow!("Failed to save password: {}", e))
    }

    pub fn get_password(connection_id: &Uuid) -> Result<String> {
        let entry = Entry::new("com.sqlmate.db", &connection_id.to_string())?;
        entry.get_password().map_err(|e| anyhow!("Failed to get password: {}", e))
    }

    pub fn delete_password(connection_id: &Uuid) -> Result<()> {
        let entry = Entry::new("com.sqlmate.db", &connection_id.to_string())?;
        entry.delete_password().map_err(|e| anyhow!("Failed to delete password: {}", e))
    }
}
