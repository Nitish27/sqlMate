use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use uuid::Uuid;

const TELEMETRY_BASE_URL: &str = "https://sqlmate-telemetry.nitishthakur-p3.workers.dev";
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(180);
const TELEMETRY_APP_DIR: &str = "sqlmate";
const TELEMETRY_STATE_FILE: &str = "telemetry.json";

#[derive(Debug, Serialize, Deserialize)]
struct TelemetryState {
    installation_id: String,
}

#[derive(Debug, Serialize)]
struct TelemetryPayload<'a> {
    installation_id: &'a str,
    app_version: &'a str,
    platform: &'a str,
    channel: &'a str,
}

#[derive(Clone)]
pub struct TelemetryClient {
    http_client: Client,
    installation_id: String,
    app_version: String,
    platform: String,
    channel: String,
}

impl TelemetryClient {
    pub fn new(app_version: String) -> Result<Self, String> {
        Ok(Self {
            http_client: Client::new(),
            installation_id: load_or_create_installation_id()?,
            app_version,
            platform: "macos".to_string(),
            channel: distribution_channel(),
        })
    }

    pub async fn send_session(&self) -> Result<(), String> {
        self.send("session").await
    }

    pub async fn send_heartbeat(&self) -> Result<(), String> {
        self.send("heartbeat").await
    }

    async fn send(&self, event_name: &str) -> Result<(), String> {
        let payload = TelemetryPayload {
            installation_id: &self.installation_id,
            app_version: &self.app_version,
            platform: &self.platform,
            channel: &self.channel,
        };

        let response = self
            .http_client
            .post(format!("{}/v1/telemetry/{}", TELEMETRY_BASE_URL, event_name))
            .json(&payload)
            .send()
            .await
            .map_err(|error| format!("Telemetry {} request failed: {}", event_name, error))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Telemetry {} request failed with status {}: {}",
                event_name, status, body
            ));
        }

        Ok(())
    }
}

pub fn start(app_version: String) {
    let telemetry_client = match TelemetryClient::new(app_version) {
        Ok(client) => client,
        Err(error) => {
            eprintln!("Telemetry initialization failed: {}", error);
            return;
        }
    };

    tauri::async_runtime::spawn(async move {
        if let Err(error) = telemetry_client.send_session().await {
            eprintln!("{}", error);
        }

        let mut heartbeat_interval = tokio::time::interval(HEARTBEAT_INTERVAL);
        heartbeat_interval.tick().await;

        loop {
            heartbeat_interval.tick().await;

            if let Err(error) = telemetry_client.send_heartbeat().await {
                eprintln!("{}", error);
            }
        }
    });
}

fn distribution_channel() -> String {
    std::env::var("SQLMATE_DISTRIBUTION_CHANNEL").unwrap_or_else(|_| "dmg".to_string())
}

fn load_or_create_installation_id() -> Result<String, String> {
    let state_path = telemetry_state_path()?;

    if state_path.exists() {
        let raw = fs::read_to_string(&state_path)
            .map_err(|error| format!("Failed to read telemetry state: {}", error))?;
        let state: TelemetryState = serde_json::from_str(&raw)
            .map_err(|error| format!("Failed to parse telemetry state: {}", error))?;

        if !state.installation_id.trim().is_empty() {
            return Ok(state.installation_id);
        }
    }

    let installation_id = Uuid::new_v4().to_string();
    let state = TelemetryState {
        installation_id: installation_id.clone(),
    };
    let serialized = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("Failed to serialize telemetry state: {}", error))?;

    if let Some(parent_dir) = state_path.parent() {
        fs::create_dir_all(parent_dir)
            .map_err(|error| format!("Failed to create telemetry directory: {}", error))?;
    }

    fs::write(&state_path, serialized)
        .map_err(|error| format!("Failed to persist telemetry state: {}", error))?;

    Ok(installation_id)
}

fn telemetry_state_path() -> Result<PathBuf, String> {
    let base_dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| "No local data directory available for telemetry.".to_string())?;

    Ok(base_dir.join(TELEMETRY_APP_DIR).join(TELEMETRY_STATE_FILE))
}
