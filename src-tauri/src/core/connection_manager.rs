use crate::core::{execution_policy::SafetyMode, ConnectionConfig, DatabaseType};
use anyhow::{anyhow, Result};
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::postgres::{PgConnectOptions, PgSslMode};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{MySql, MySqlPool, PgPool, Pool, Postgres, Sqlite, SqlitePool};
use ssh2::Session;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, OwnedRwLockReadGuard, RwLock};
use tokio::task::JoinHandle;
use uuid::Uuid;

pub struct SshTunnel {
    pub local_port: u16,
    shutdown: Arc<AtomicBool>,
    pub task_handle: JoinHandle<()>,
}

impl SshTunnel {
    fn stop(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
        self.task_handle.abort();
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.stop();
    }
}

fn mysql_ssl_mode(config: &ConnectionConfig) -> Result<MySqlSslMode> {
    if !config.ssl_enabled {
        return Ok(MySqlSslMode::Disabled);
    }
    match config.ssl_mode.as_deref().unwrap_or("prefer") {
        "disable" => Ok(MySqlSslMode::Disabled),
        "prefer" => Ok(MySqlSslMode::Preferred),
        "require" => Ok(MySqlSslMode::Required),
        "verify-ca" => Ok(MySqlSslMode::VerifyCa),
        "verify-full" => Ok(MySqlSslMode::VerifyIdentity),
        mode => Err(anyhow!("Unsupported MySQL SSL mode: {}", mode)),
    }
}

fn postgres_ssl_mode(config: &ConnectionConfig) -> Result<PgSslMode> {
    if !config.ssl_enabled {
        return Ok(PgSslMode::Disable);
    }
    match config.ssl_mode.as_deref().unwrap_or("prefer") {
        "disable" => Ok(PgSslMode::Disable),
        "prefer" => Ok(PgSslMode::Prefer),
        "require" => Ok(PgSslMode::Require),
        "verify-ca" => Ok(PgSslMode::VerifyCa),
        "verify-full" => Ok(PgSslMode::VerifyFull),
        mode => Err(anyhow!("Unsupported PostgreSQL SSL mode: {}", mode)),
    }
}

fn revoke_ai_on_production_transition(
    previous: Option<&ConnectionConfig>,
    next: &mut ConnectionConfig,
) {
    if next.environment.as_deref() == Some("production")
        && previous.is_some_and(|config| config.environment.as_deref() != Some("production"))
    {
        next.ai_enabled = Some(false);
    }
}

fn validate_connection_config(config: &ConnectionConfig) -> Result<()> {
    match config.db_type {
        DatabaseType::Sqlite => {
            if config
                .database
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                return Err(anyhow!("SQLite database file path is required"));
            }
        }
        DatabaseType::Postgres | DatabaseType::MySql => {
            if config.host.as_deref().unwrap_or_default().trim().is_empty() {
                return Err(anyhow!("Database host is required"));
            }
            if config.port == Some(0) {
                return Err(anyhow!("Database port must be between 1 and 65535"));
            }
            if config
                .username
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                return Err(anyhow!("Database user is required"));
            }
            if matches!(config.db_type, DatabaseType::Postgres)
                && config
                    .database
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .is_empty()
            {
                return Err(anyhow!("PostgreSQL database is required"));
            }
            if config.ssl_enabled {
                match config.db_type {
                    DatabaseType::Postgres => {
                        postgres_ssl_mode(config)?;
                    }
                    DatabaseType::MySql => {
                        mysql_ssl_mode(config)?;
                    }
                    DatabaseType::Sqlite => unreachable!(),
                }
                if config.ssh_enabled && config.ssl_mode.as_deref() == Some("verify-full") {
                    return Err(anyhow!("Verify-full over SSH is not supported because the tunnel uses localhost; use verify-ca or connect directly"));
                }
                let has_cert = config
                    .ssl_cert_path
                    .as_ref()
                    .is_some_and(|path| !path.is_empty());
                let has_key = config
                    .ssl_key_path
                    .as_ref()
                    .is_some_and(|path| !path.is_empty());
                if has_cert != has_key {
                    return Err(anyhow!(
                        "SSL client certificate and key must be set together"
                    ));
                }
            }
            if config.ssh_enabled {
                if config
                    .ssh_host
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .is_empty()
                {
                    return Err(anyhow!("SSH host is required"));
                }
                if config.ssh_port == Some(0) {
                    return Err(anyhow!("SSH port must be between 1 and 65535"));
                }
                if config
                    .ssh_username
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .is_empty()
                {
                    return Err(anyhow!("SSH user is required"));
                }
                if config.ssh_auth_method.as_deref() == Some("key")
                    && config
                        .ssh_private_key_path
                        .as_deref()
                        .unwrap_or_default()
                        .is_empty()
                {
                    return Err(anyhow!("SSH private key path is required"));
                }
            }
        }
    }
    Ok(())
}

pub struct ConnectionManager {
    postgres_pools: Arc<Mutex<HashMap<Uuid, PgPool>>>,
    mysql_pools: Arc<Mutex<HashMap<Uuid, MySqlPool>>>,
    sqlite_pools: Arc<Mutex<HashMap<Uuid, SqlitePool>>>,
    configs: Arc<Mutex<HashMap<Uuid, ConnectionConfig>>>,
    passwords: Arc<Mutex<HashMap<Uuid, Option<String>>>>,
    tunnels: Arc<Mutex<HashMap<Uuid, Arc<SshTunnel>>>>,
    context_locks: Mutex<HashMap<Uuid, Arc<RwLock<()>>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            postgres_pools: Arc::new(Mutex::new(HashMap::new())),
            mysql_pools: Arc::new(Mutex::new(HashMap::new())),
            sqlite_pools: Arc::new(Mutex::new(HashMap::new())),
            configs: Arc::new(Mutex::new(HashMap::new())),
            passwords: Arc::new(Mutex::new(HashMap::new())),
            tunnels: Arc::new(Mutex::new(HashMap::new())),
            context_locks: Mutex::new(HashMap::new()),
        }
    }

    async fn context_lock(&self, id: &Uuid) -> Arc<RwLock<()>> {
        self.context_locks
            .lock()
            .await
            .entry(*id)
            .or_insert_with(|| Arc::new(RwLock::new(())))
            .clone()
    }

    pub async fn execution_guard(&self, id: &Uuid) -> OwnedRwLockReadGuard<()> {
        self.context_lock(id).await.read_owned().await
    }

    pub async fn get_tunnels(&self) -> tokio::sync::MutexGuard<'_, HashMap<Uuid, Arc<SshTunnel>>> {
        self.tunnels.lock().await
    }

    pub async fn connect(
        &self,
        mut config: ConnectionConfig,
        password: Option<String>,
    ) -> Result<()> {
        validate_connection_config(&config)?;
        let id = config.id;
        let _guard = self.context_lock(&id).await.write_owned().await;
        let result = match config.db_type {
            DatabaseType::Postgres => {
                self.connect_postgres(config.clone(), password.clone())
                    .await
            }
            DatabaseType::MySql => self.connect_mysql(config.clone(), password.clone()).await,
            DatabaseType::Sqlite => self.connect_sqlite(config.clone()).await,
        };
        result?;
        match config.db_type {
            DatabaseType::Postgres => {
                let stale_mysql = self.mysql_pools.lock().await.remove(&id);
                let stale_sqlite = self.sqlite_pools.lock().await.remove(&id);
                if let Some(pool) = stale_mysql {
                    pool.close().await;
                }
                if let Some(pool) = stale_sqlite {
                    pool.close().await;
                }
            }
            DatabaseType::MySql => {
                let stale_postgres = self.postgres_pools.lock().await.remove(&id);
                let stale_sqlite = self.sqlite_pools.lock().await.remove(&id);
                if let Some(pool) = stale_postgres {
                    pool.close().await;
                }
                if let Some(pool) = stale_sqlite {
                    pool.close().await;
                }
            }
            DatabaseType::Sqlite => {
                let stale_postgres = self.postgres_pools.lock().await.remove(&id);
                let stale_mysql = self.mysql_pools.lock().await.remove(&id);
                if let Some(pool) = stale_postgres {
                    pool.close().await;
                }
                if let Some(pool) = stale_mysql {
                    pool.close().await;
                }
                if let Some(tunnel) = self.tunnels.lock().await.remove(&id) {
                    tunnel.stop();
                }
            }
        }
        let mut configs = self.configs.lock().await;
        revoke_ai_on_production_transition(configs.get(&id), &mut config);
        configs.insert(id, config);
        self.passwords.lock().await.insert(id, password);
        Ok(())
    }

    pub async fn execution_context(&self, id: &Uuid) -> Result<(String, SafetyMode)> {
        let configs = self.configs.lock().await;
        let config = configs
            .get(id)
            .ok_or_else(|| anyhow!("Connection not found"))?;
        let database = config
            .database
            .clone()
            .unwrap_or_else(|| match config.db_type {
                DatabaseType::Postgres => "postgres".to_string(),
                DatabaseType::MySql => String::new(),
                DatabaseType::Sqlite => String::new(),
            });
        Ok((database, config.safety_mode))
    }

    pub async fn set_safety_mode(&self, id: &Uuid, mode: SafetyMode) -> Result<()> {
        let _guard = self.context_lock(id).await.write_owned().await;
        let mut configs = self.configs.lock().await;
        let config = configs
            .get_mut(id)
            .ok_or_else(|| anyhow!("Connection not found"))?;
        config.safety_mode = mode;
        Ok(())
    }

    pub async fn authorize_ai(&self, id: &Uuid) -> Result<()> {
        let configs = self.configs.lock().await;
        let config = configs
            .get(id)
            .ok_or_else(|| anyhow!("Connection not found"))?;
        if config.ai_allowed() {
            Ok(())
        } else {
            Err(anyhow!("AI is disabled for this connection. Enable it in connection settings before sending schema or SQL to a provider."))
        }
    }

    pub async fn set_ai_metadata(
        &self,
        id: &Uuid,
        environment: String,
        ai_enabled: Option<bool>,
    ) -> Result<bool> {
        let _guard = self.context_lock(id).await.write_owned().await;
        let mut configs = self.configs.lock().await;
        let config = configs
            .get_mut(id)
            .ok_or_else(|| anyhow!("Connection not found"))?;
        let entering_production =
            config.environment.as_deref() != Some("production") && environment == "production";
        config.environment = Some(environment);
        config.ai_enabled = if entering_production {
            Some(false)
        } else {
            ai_enabled
        };
        Ok(config.ai_allowed())
    }

    pub async fn test_connection(
        &self,
        config: ConnectionConfig,
        password: Option<String>,
    ) -> Result<()> {
        let probe = ConnectionManager::new();
        let id = config.id;
        probe.connect(config, password).await?;
        probe.disconnect(&id).await
    }

    async fn establish_ssh_tunnel(&self, config: &ConnectionConfig) -> Result<Arc<SshTunnel>> {
        let ssh_host = config
            .ssh_host
            .as_ref()
            .ok_or_else(|| anyhow!("SSH host missing"))?;
        let ssh_port = config.ssh_port.unwrap_or(22);
        let ssh_user = config
            .ssh_username
            .as_ref()
            .ok_or_else(|| anyhow!("SSH username missing"))?;

        // Connect to SSH server
        let tcp = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::net::TcpStream::connect((ssh_host.as_str(), ssh_port)),
        )
        .await
        .map_err(|_| anyhow!("SSH connection timed out"))??
        .into_std()?;
        tcp.set_nonblocking(false)?;
        let mut sess = Session::new()?;
        sess.set_timeout(5_000);
        sess.set_tcp_stream(tcp);
        sess.handshake()?;

        // Auth
        if config.ssh_auth_method.as_deref() == Some("password") {
            let pass = config
                .ssh_password
                .as_ref()
                .ok_or_else(|| anyhow!("SSH password missing"))?;
            sess.userauth_password(ssh_user, pass)?;
        } else if let Some(key_path_str) = &config.ssh_private_key_path {
            let mut resolved_path = std::path::PathBuf::from(key_path_str);

            // If the path is just a file name like "id_rsa" or starts with "~", resolve it against the home directory
            if !resolved_path.is_absolute() {
                if let Some(home) = dirs::home_dir() {
                    if key_path_str.starts_with("~/") {
                        resolved_path = home.join(key_path_str.trim_start_matches("~/"));
                    } else if !key_path_str.contains('/') && !key_path_str.contains('\\') {
                        // Just a filename like "id_rsa", look in ~/.ssh/
                        resolved_path = home.join(".ssh").join(key_path_str);
                    }
                }
            }

            if !resolved_path.exists() {
                return Err(anyhow!(
                    "SSH key file not found at: {}",
                    resolved_path.display()
                ));
            }

            // Attempt to find the corresponding .pub file
            // libssh2 often requires the explicit public key file to successfully authenticate with modern keys
            let mut pub_path_opt = None;
            let pubkey_path =
                resolved_path.with_extension(if let Some(ext) = resolved_path.extension() {
                    format!("{}.pub", ext.to_string_lossy())
                } else {
                    "pub".to_string()
                });

            // If it was just "id_rsa", with_extension("pub") makes "id_rsa.pub"
            if pubkey_path.exists() {
                pub_path_opt = Some(pubkey_path);
            } else {
                // Fallback for names without extensions that might not work with with_extension right
                let mut alt_pubkey = resolved_path.clone();
                if let Some(name) = alt_pubkey.file_name() {
                    let mut new_name = name.to_os_string();
                    new_name.push(".pub");
                    alt_pubkey.set_file_name(new_name);
                    if alt_pubkey.exists() {
                        pub_path_opt = Some(alt_pubkey);
                    }
                }
            }

            match sess.userauth_pubkey_file(ssh_user, pub_path_opt.as_deref(), &resolved_path, None)
            {
                Ok(_) => {}
                Err(e) => return Err(anyhow!("SSH pubkey auth failed: {}", e)),
            }
        } else {
            return Err(anyhow!("Unsupported or missing SSH auth method"));
        }

        if !sess.authenticated() {
            return Err(anyhow!("SSH authentication failed"));
        }

        // Bind local listener to a random port
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let local_port = listener.local_addr()?.port();

        let remote_db_host = config
            .host
            .clone()
            .unwrap_or_else(|| "127.0.0.1".to_string());
        let remote_db_port = config.port.unwrap_or(match config.db_type {
            DatabaseType::Postgres => 5432,
            DatabaseType::MySql => 3306,
            DatabaseType::Sqlite => unreachable!(),
        });

        let sess_arc = Arc::new(std::sync::Mutex::new(sess));
        let shutdown = Arc::new(AtomicBool::new(false));
        let listener_shutdown = shutdown.clone();

        let task_handle = tokio::task::spawn_blocking(move || {
            while !listener_shutdown.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut local_stream, _)) => {
                        let sess_locked = sess_arc.lock().unwrap();
                        let _ = sess_locked.set_blocking(true); // Ensure blocking for channel creation
                        match sess_locked.channel_direct_tcpip(
                            &remote_db_host,
                            remote_db_port,
                            None,
                        ) {
                            Ok(mut channel) => {
                                let sess_for_thread = sess_arc.clone();
                                let channel_shutdown = listener_shutdown.clone();
                                std::thread::spawn(move || {
                                    let mut local_stream_clone = local_stream
                                        .try_clone()
                                        .expect("Failed to clone local stream");

                                    // Set non-blocking on the session for this thread's channel
                                    let sess_locked = sess_for_thread.lock().unwrap();
                                    sess_locked.set_blocking(false);
                                    drop(sess_locked);

                                    let mut buf_local = [0; 4096];
                                    let mut buf_remote = [0; 4096];

                                    local_stream.set_nonblocking(true).unwrap();

                                    while !channel_shutdown.load(Ordering::Relaxed) {
                                        let mut active = false;

                                        // Local -> Remote
                                        match local_stream.read(&mut buf_local) {
                                            Ok(0) => break,
                                            Ok(n) => {
                                                let mut written = 0;
                                                while written < n
                                                    && !channel_shutdown.load(Ordering::Relaxed)
                                                {
                                                    let sess_locked =
                                                        sess_for_thread.lock().unwrap();
                                                    let _ = sess_locked.set_blocking(false);
                                                    match channel.write(&buf_local[written..n]) {
                                                            Ok(0) => break,
                                                            Ok(m) => {
                                                                written += m;
                                                                active = true;
                                                            }
                                                            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                                                drop(sess_locked);
                                                                std::thread::sleep(std::time::Duration::from_millis(1));
                                                                continue;
                                                            }
                                                            Err(_) => break,
                                                        }
                                                }
                                            }
                                            Err(ref e)
                                                if e.kind() == std::io::ErrorKind::WouldBlock => {}
                                            Err(_) => break,
                                        }

                                        // Remote -> Local
                                        {
                                            let sess_locked = sess_for_thread.lock().unwrap();
                                            let _ = sess_locked.set_blocking(false);
                                            match channel.read(&mut buf_remote) {
                                                Ok(0) => break,
                                                Ok(n) => {
                                                    if local_stream_clone
                                                        .write_all(&buf_remote[..n])
                                                        .is_err()
                                                    {
                                                        break;
                                                    }
                                                    active = true;
                                                }
                                                Err(ref e)
                                                    if e.kind()
                                                        == std::io::ErrorKind::WouldBlock => {} // EAGAIN
                                                Err(e) => {
                                                    eprintln!("SSH Remote Read Error: {:?}", e);
                                                    break;
                                                }
                                            }
                                        }

                                        if !active {
                                            std::thread::sleep(std::time::Duration::from_millis(5));
                                        }
                                    }
                                });
                            }
                            Err(e) => eprintln!("Failed to open SSH channel: {}", e),
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    Err(e) => {
                        eprintln!("Local listener error: {}", e);
                        break;
                    }
                }
            }
        });

        Ok(Arc::new(SshTunnel {
            local_port,
            shutdown,
            task_handle,
        }))
    }

    async fn connect_postgres(
        &self,
        config: ConnectionConfig,
        password: Option<String>,
    ) -> Result<()> {
        let mut final_config = config.clone();

        let tunnel = if config.ssh_enabled {
            let tunnel = self.establish_ssh_tunnel(&config).await?;
            final_config.host = Some("127.0.0.1".to_string());
            final_config.port = Some(tunnel.local_port);
            Some(tunnel)
        } else {
            None
        };

        let host = final_config.host.as_deref().unwrap_or("localhost");
        let port = final_config.port.unwrap_or(5432);
        let user = final_config.username.as_deref().unwrap_or("postgres");
        let db = final_config.database.as_deref().unwrap_or("postgres");
        let pass = password.unwrap_or_default();

        let mut opts = PgConnectOptions::new()
            .host(host)
            .port(port)
            .username(user)
            .password(&pass)
            .database(db);

        // Apply SSL settings
        if final_config.ssl_enabled {
            opts = opts.ssl_mode(postgres_ssl_mode(&final_config)?);

            if let Some(ca) = &final_config.ssl_ca_path {
                opts = opts.ssl_root_cert(ca);
            }
            if let Some(cert) = &final_config.ssl_cert_path {
                opts = opts.ssl_client_cert(cert);
            }
            if let Some(key) = &final_config.ssl_key_path {
                opts = opts.ssl_client_key(key);
            }
        }

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(5))
            .connect_with(opts)
            .await?;

        let previous = self.postgres_pools.lock().await.insert(config.id, pool);
        if let Some(previous) = previous {
            previous.close().await;
        }
        if let Some(previous) = self.tunnels.lock().await.remove(&config.id) {
            previous.stop();
        }
        if let Some(tunnel) = tunnel {
            self.tunnels.lock().await.insert(config.id, tunnel);
        }

        Ok(())
    }

    async fn connect_mysql(
        &self,
        config: ConnectionConfig,
        password: Option<String>,
    ) -> Result<()> {
        let mut final_config = config.clone();

        let tunnel = if config.ssh_enabled {
            let tunnel = self.establish_ssh_tunnel(&config).await?;
            final_config.host = Some("127.0.0.1".to_string());
            final_config.port = Some(tunnel.local_port);
            Some(tunnel)
        } else {
            None
        };

        let host = final_config.host.as_deref().unwrap_or("localhost");
        let port = final_config.port.unwrap_or(3306);
        let user = final_config.username.as_deref().unwrap_or("root");
        let db = final_config.database.as_deref().unwrap_or("");
        let pass = password.unwrap_or_default();

        let mut opts = MySqlConnectOptions::new()
            .host(host)
            .port(port)
            .username(user)
            .password(&pass)
            .database(db);

        opts = opts.ssl_mode(mysql_ssl_mode(&final_config)?);
        if final_config.ssl_enabled {
            if let Some(ca) = &final_config.ssl_ca_path {
                opts = opts.ssl_ca(ca);
            }
            if let Some(cert) = &final_config.ssl_cert_path {
                opts = opts.ssl_client_cert(cert);
            }
            if let Some(key) = &final_config.ssl_key_path {
                opts = opts.ssl_client_key(key);
            }
        }

        let pool = sqlx::mysql::MySqlPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(5))
            .connect_with(opts)
            .await?;

        let previous = self.mysql_pools.lock().await.insert(config.id, pool);
        if let Some(previous) = previous {
            previous.close().await;
        }
        if let Some(previous) = self.tunnels.lock().await.remove(&config.id) {
            previous.stop();
        }
        if let Some(tunnel) = tunnel {
            self.tunnels.lock().await.insert(config.id, tunnel);
        }

        Ok(())
    }

    async fn connect_sqlite(&self, config: ConnectionConfig) -> Result<()> {
        let db_path = config
            .database
            .clone()
            .ok_or_else(|| anyhow!("Path required for SQLite"))?;
        let options = SqliteConnectOptions::new().filename(db_path);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_secs(5))
            .connect_with(options)
            .await
            .map_err(|e| anyhow!("Failed to connect to SQLite: {}", e))?;

        let previous = self.sqlite_pools.lock().await.insert(config.id, pool);
        if let Some(previous) = previous {
            previous.close().await;
        }
        Ok(())
    }

    pub async fn switch_database(&self, id: &Uuid, db_name: &str) -> Result<()> {
        let _guard = self.context_lock(id).await.write_owned().await;
        let config = {
            let configs = self.configs.lock().await;
            configs
                .get(id)
                .cloned()
                .ok_or_else(|| anyhow!("Connection config not found"))?
        };
        let password = {
            let passwords = self.passwords.lock().await;
            passwords.get(id).cloned().flatten()
        };

        let mut new_config = config.clone();
        new_config.database = Some(db_name.to_string());

        let result = match new_config.db_type {
            DatabaseType::Postgres => {
                self.connect_postgres(new_config.clone(), password.clone())
                    .await
            }
            DatabaseType::MySql => {
                self.connect_mysql(new_config.clone(), password.clone())
                    .await
            }
            DatabaseType::Sqlite => Err(anyhow!(
                "SQLite does not support switching databases within the same file connection."
            )),
        };

        if result.is_ok() {
            // Update stored config after successful switch

            {
                let mut configs = self.configs.lock().await;
                configs.insert(*id, new_config);
            }
            {
                let mut passwords = self.passwords.lock().await;
                passwords.insert(*id, password);
            }
        }

        result
    }

    pub async fn disconnect(&self, id: &Uuid) -> Result<()> {
        let _guard = self.context_lock(id).await.write_owned().await;
        {
            let mut configs = self.configs.lock().await;
            configs.remove(id);
        }
        {
            let mut passwords = self.passwords.lock().await;
            passwords.remove(id);
        }
        let postgres = self.postgres_pools.lock().await.remove(id);
        let mysql = self.mysql_pools.lock().await.remove(id);
        let sqlite = self.sqlite_pools.lock().await.remove(id);
        if let Some(pool) = postgres {
            pool.close().await;
        }
        if let Some(pool) = mysql {
            pool.close().await;
        }
        if let Some(pool) = sqlite {
            pool.close().await;
        }
        {
            let mut tunnels = self.tunnels.lock().await;
            if let Some(tunnel) = tunnels.remove(id) {
                tunnel.stop();
            }
        }
        Ok(())
    }

    pub async fn get_postgres_pools(
        &self,
    ) -> tokio::sync::OwnedMutexGuard<HashMap<Uuid, Pool<Postgres>>> {
        self.postgres_pools.clone().lock_owned().await
    }

    pub async fn get_config(&self, id: &Uuid) -> Result<ConnectionConfig> {
        self.configs
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow!("Connection config not found"))
    }

    pub async fn get_mysql_pools(
        &self,
    ) -> tokio::sync::OwnedMutexGuard<HashMap<Uuid, Pool<MySql>>> {
        self.mysql_pools.clone().lock_owned().await
    }

    pub async fn get_sqlite_pools(
        &self,
    ) -> tokio::sync::OwnedMutexGuard<HashMap<Uuid, Pool<Sqlite>>> {
        self.sqlite_pools.clone().lock_owned().await
    }
}

#[cfg(test)]
mod context_tests {
    use super::ConnectionManager;
    use tokio::time::{timeout, Duration};
    use uuid::Uuid;

    #[tokio::test]
    async fn connection_switch_waits_for_an_active_execution() {
        let manager = ConnectionManager::new();
        let connection_id = Uuid::new_v4();
        let running = manager.execution_guard(&connection_id).await;
        let lock = manager.context_lock(&connection_id).await;
        assert!(
            timeout(Duration::from_millis(10), lock.clone().write_owned())
                .await
                .is_err()
        );
        drop(running);
        assert!(timeout(Duration::from_secs(1), lock.write_owned())
            .await
            .is_ok());
    }
}

#[cfg(test)]
mod connection_tests {
    use super::*;
    use serde_json::json;

    fn config() -> ConnectionConfig {
        serde_json::from_value(json!({
            "id": Uuid::new_v4(), "name": "test", "db_type": "MySql",
            "host": "db.example.com", "port": 3306, "username": "user", "database": "app",
            "ssl_enabled": true, "ssl_mode": "verify-full", "ssl_ca_path": null,
            "ssl_cert_path": null, "ssl_key_path": null, "ssh_enabled": false,
            "ssh_host": null, "ssh_port": null, "ssh_username": null,
            "ssh_auth_method": null, "ssh_password": null, "ssh_private_key_path": null,
            "environment": "production", "color_tag": null, "safety_mode": "Alert"
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn changing_a_live_connection_to_production_revokes_ai_until_reapproved() {
        let manager = ConnectionManager::new();
        let mut connection = config();
        connection.environment = Some("dev".into());
        connection.ai_enabled = Some(true);
        let id = connection.id;
        manager.configs.lock().await.insert(id, connection);

        assert!(manager.authorize_ai(&id).await.is_ok());
        assert!(!manager
            .set_ai_metadata(&id, "production".into(), Some(true))
            .await
            .unwrap());
        assert!(manager.authorize_ai(&id).await.is_err());
        assert!(manager
            .set_ai_metadata(&id, "production".into(), Some(true))
            .await
            .unwrap());
        assert!(manager.authorize_ai(&id).await.is_ok());
    }

    #[test]
    fn fresh_production_opt_in_is_not_a_tag_transition() {
        let mut new_connection = config();
        new_connection.ai_enabled = Some(true);
        revoke_ai_on_production_transition(None, &mut new_connection);
        assert!(new_connection.ai_allowed());

        let mut previous = config();
        previous.environment = Some("dev".into());
        revoke_ai_on_production_transition(Some(&previous), &mut new_connection);
        assert!(!new_connection.ai_allowed());
    }

    #[test]
    fn mysql_verify_full_requires_identity_verification() {
        assert!(matches!(
            mysql_ssl_mode(&config()).unwrap(),
            MySqlSslMode::VerifyIdentity
        ));
    }

    #[test]
    fn postgres_invalid_tls_mode_never_downgrades_to_plaintext() {
        let mut connection = config();
        connection.db_type = DatabaseType::Postgres;
        connection.ssl_mode = Some("invalid".to_string());
        assert!(postgres_ssl_mode(&connection).is_err());

        connection.ssl_mode = Some("verify-full".to_string());
        connection.ssh_enabled = true;
        assert!(validate_connection_config(&connection)
            .unwrap_err()
            .to_string()
            .contains("Verify-full over SSH"));
    }

    #[test]
    fn invalid_connection_fields_fail_before_network_access() {
        let mut invalid = config();
        invalid.port = Some(0);
        assert!(validate_connection_config(&invalid)
            .unwrap_err()
            .to_string()
            .contains("port"));

        invalid.port = Some(3306);
        invalid.ssh_enabled = true;
        invalid.ssl_mode = Some("verify-ca".to_string());
        assert!(validate_connection_config(&invalid)
            .unwrap_err()
            .to_string()
            .contains("SSH host"));
    }

    #[tokio::test]
    async fn test_and_connect_share_preflight_validation() {
        let manager = ConnectionManager::new();
        let mut invalid = config();
        invalid.port = Some(0);
        let tested = manager
            .test_connection(invalid.clone(), None)
            .await
            .unwrap_err();
        let connected = manager.connect(invalid, None).await.unwrap_err();
        assert_eq!(tested.to_string(), connected.to_string());
    }

    #[tokio::test]
    async fn disconnect_releases_a_postgres_tunnel() {
        let manager = ConnectionManager::new();
        let id = Uuid::new_v4();
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://user:pass@localhost/app")
            .unwrap();
        manager.postgres_pools.lock().await.insert(id, pool);
        manager.tunnels.lock().await.insert(
            id,
            Arc::new(SshTunnel {
                local_port: 12345,
                shutdown: Arc::new(AtomicBool::new(false)),
                task_handle: tokio::spawn(async {}),
            }),
        );

        manager.disconnect(&id).await.unwrap();
        assert!(!manager.tunnels.lock().await.contains_key(&id));
    }

    #[tokio::test]
    async fn reconnecting_sqlite_closes_the_previous_pool() {
        let manager = ConnectionManager::new();
        let mut connection = config();
        connection.db_type = DatabaseType::Sqlite;
        connection.database = Some(":memory:".to_string());
        connection.ssl_enabled = false;
        manager.connect(connection.clone(), None).await.unwrap();
        let original = manager
            .sqlite_pools
            .lock()
            .await
            .get(&connection.id)
            .unwrap()
            .clone();

        manager.connect(connection.clone(), None).await.unwrap();
        assert!(original.is_closed());
        assert!(manager
            .sqlite_pools
            .lock()
            .await
            .contains_key(&connection.id));
        manager.disconnect(&connection.id).await.unwrap();
    }

    #[tokio::test]
    async fn sqlite_filename_with_url_fragment_character_is_not_parsed_as_uri() {
        let path = std::env::temp_dir().join(format!("sqlmate#probe-{}.db", Uuid::new_v4()));
        let seed = SqlitePool::connect_with(
            SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true),
        )
        .await
        .unwrap();
        seed.close().await;

        let manager = ConnectionManager::new();
        let mut connection = config();
        connection.db_type = DatabaseType::Sqlite;
        connection.database = Some(path.to_string_lossy().into_owned());
        connection.ssl_enabled = false;
        manager.connect(connection.clone(), None).await.unwrap();
        manager.disconnect(&connection.id).await.unwrap();
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn stopping_a_tunnel_signals_its_listener() {
        let tunnel = SshTunnel {
            local_port: 12345,
            shutdown: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            task_handle: tokio::spawn(async {}),
        };
        tunnel.stop();
        assert!(tunnel.shutdown.load(std::sync::atomic::Ordering::Relaxed));
    }
}
