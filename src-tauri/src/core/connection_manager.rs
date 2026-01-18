use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;
use anyhow::{Result, anyhow};
use crate::core::{ConnectionConfig, DatabaseType};
use std::net::{TcpListener, TcpStream};
use ssh2::Session;
use std::io::{Read, Write};
use tokio::task::JoinHandle;
use sqlx::{Pool, Postgres, MySql, Sqlite, Connection, PgPool, MySqlPool, SqlitePool};
use sqlx::postgres::{PgConnectOptions, PgSslMode};
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use std::time::Duration;

pub struct SshTunnel {
    pub local_port: u16,
    pub task_handle: JoinHandle<()>,
}

pub struct ConnectionManager {
    postgres_pools: Arc<Mutex<HashMap<Uuid, PgPool>>>,
    mysql_pools: Arc<Mutex<HashMap<Uuid, MySqlPool>>>,
    sqlite_pools: Arc<Mutex<HashMap<Uuid, SqlitePool>>>,
    configs: Arc<Mutex<HashMap<Uuid, ConnectionConfig>>>,
    passwords: Arc<Mutex<HashMap<Uuid, Option<String>>>>,
    tunnels: Arc<Mutex<HashMap<Uuid, Arc<SshTunnel>>>>,
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
        }
    }

    pub async fn get_tunnels(&self) -> tokio::sync::MutexGuard<'_, HashMap<Uuid, Arc<SshTunnel>>> {
        self.tunnels.lock().await
    }

    pub async fn connect(&self, config: ConnectionConfig, password: Option<String>) -> Result<()> {
        let id = config.id;
        {
            let mut configs = self.configs.lock().await;
            configs.insert(id, config.clone());
        }
        {
            let mut passwords = self.passwords.lock().await;
            passwords.insert(id, password.clone());
        }

        match config.db_type {
            DatabaseType::Postgres => self.connect_postgres(config, password).await,
            DatabaseType::MySql => self.connect_mysql(config, password).await,
            DatabaseType::Sqlite => self.connect_sqlite(config).await,
        }
    }

    pub async fn test_connection(&self, config: ConnectionConfig, password: Option<String>) -> Result<()> {
        match config.db_type {
            DatabaseType::Postgres => {
                let host = config.host.clone().ok_or_else(|| anyhow!("Host required for Postgres"))?;
                let port = config.port.unwrap_or(5432);
                let user = config.username.clone().ok_or_else(|| anyhow!("Username required for Postgres"))?;
                let db = config.database.clone().ok_or_else(|| anyhow!("Database name required for Postgres"))?;
                let pass = password.unwrap_or_default();
                let url = format!("postgres://{}:{}@{}:{}/{}", user, pass, host, port, db);
                
                let mut conn = sqlx::postgres::PgConnection::connect(&url).await?;
                conn.ping().await.map_err(|e| anyhow!("Ping failed: {}", e))
            },
            DatabaseType::MySql => {
                let host = config.host.clone().ok_or_else(|| anyhow!("Host required for MySQL"))?;
                let port = config.port.unwrap_or(3306);
                let user = config.username.clone().ok_or_else(|| anyhow!("Username required for MySQL"))?;
                let db = config.database.clone().ok_or_else(|| anyhow!("Database name required for MySQL"))?;
                let pass = password.unwrap_or_default();
                let url = format!("mysql://{}:{}@{}:{}/{}", user, pass, host, port, db);
                
                let mut conn = sqlx::mysql::MySqlConnection::connect(&url).await?;
                conn.ping().await.map_err(|e| anyhow!("Ping failed: {}", e))
            },
            DatabaseType::Sqlite => {
                let db_path = config.database.clone().ok_or_else(|| anyhow!("Path required for SQLite"))?;
                let url = format!("sqlite:{}", db_path);
                
                let mut conn = sqlx::sqlite::SqliteConnection::connect(&url).await?;
                conn.ping().await.map_err(|e| anyhow!("Ping failed: {}", e))
            },
        }
    }

    async fn establish_ssh_tunnel(&self, config: &ConnectionConfig) -> Result<Arc<SshTunnel>> {
        let ssh_host = config.ssh_host.as_ref().ok_or_else(|| anyhow!("SSH host missing"))?;
        let ssh_port = config.ssh_port.unwrap_or(22);
        let ssh_user = config.ssh_username.as_ref().ok_or_else(|| anyhow!("SSH username missing"))?;
        
        // Connect to SSH server
        let tcp = TcpStream::connect(format!("{}:{}", ssh_host, ssh_port))?;
        let mut sess = Session::new()?;
        sess.set_tcp_stream(tcp);
        sess.handshake()?;

        // Auth
        if config.ssh_auth_method.as_deref() == Some("password") {
            let pass = config.ssh_password.as_ref().ok_or_else(|| anyhow!("SSH password missing"))?;
            sess.userauth_password(ssh_user, pass)?;
        } else if let Some(key_path) = &config.ssh_private_key_path {
            sess.userauth_pubkey_file(ssh_user, None, std::path::Path::new(key_path), None)?;
        } else {
            return Err(anyhow!("Unsupported or missing SSH auth method"));
        }

        if !sess.authenticated() {
            return Err(anyhow!("SSH authentication failed"));
        }

        // Bind local listener to a random port
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let local_port = listener.local_addr()?.port();
        
        let remote_db_host = config.host.clone().unwrap_or_else(|| "127.0.0.1".to_string());
        let remote_db_port = config.port.unwrap_or(5432); // Default for PG, but we should use actual config port

        let sess_arc = Arc::new(Mutex::new(sess));
        
        let task_handle = tokio::task::spawn_blocking(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(mut local_stream) => {
                        let sess_locked = tokio::runtime::Handle::current().block_on(sess_arc.lock());
                        match sess_locked.channel_direct_tcpip(&remote_db_host, remote_db_port, None) {
                            Ok(mut channel) => {
                                    let sess_for_thread = sess_arc.clone();
                                    std::thread::spawn(move || {
                                        let mut local_stream_clone = local_stream.try_clone().expect("Failed to clone local stream");
                                        
                                        // Set non-blocking on the session for this thread's channel
                                        let sess_locked = tokio::runtime::Handle::current().block_on(sess_for_thread.lock());
                                        sess_locked.set_blocking(false);
                                        drop(sess_locked);

                                        let mut buf_local = [0; 4096];
                                        let mut buf_remote = [0; 4096];
                                        
                                        local_stream.set_nonblocking(true).unwrap();

                                        loop {
                                            let mut active = false;
                                            
                                            // Local -> Remote
                                            match local_stream.read(&mut buf_local) {
                                                Ok(0) => break,
                                                Ok(n) => {
                                                    let sess_locked = tokio::runtime::Handle::current().block_on(sess_for_thread.lock());
                                                    sess_locked.set_blocking(false);
                                                    if channel.write_all(&buf_local[..n]).is_err() { break; }
                                                    active = true;
                                                }
                                                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                                                Err(_) => break,
                                            }

                                            // Remote -> Local
                                            {
                                                let sess_locked = tokio::runtime::Handle::current().block_on(sess_for_thread.lock());
                                                let _ = sess_locked.set_blocking(false);
                                                match channel.read(&mut buf_remote) {
                                                    Ok(0) => break,
                                                    Ok(n) => {
                                                        if local_stream_clone.write_all(&buf_remote[..n]).is_err() { break; }
                                                        active = true;
                                                    }
                                                    Err(ref e) if e.raw_os_error() == Some(-37) => {} // EAGAIN
                                                    Err(_) => break,
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
                    Err(e) => eprintln!("Local listener error: {}", e),
                }
            }
        });

        Ok(Arc::new(SshTunnel { local_port, task_handle }))
    }

    async fn connect_postgres(&self, config: ConnectionConfig, password: Option<String>) -> Result<()> {
        let mut final_config = config.clone();
        
        if config.ssh_enabled {
            let tunnel = self.establish_ssh_tunnel(&config).await?;
            final_config.host = Some("127.0.0.1".to_string());
            final_config.port = Some(tunnel.local_port);
            
            let mut tunnels = self.tunnels.lock().await;
            tunnels.insert(config.id, tunnel);
        }

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
            let mode = match final_config.ssl_mode.as_deref() {
                Some("require") => PgSslMode::Require,
                Some("verify-ca") => PgSslMode::VerifyCa,
                Some("verify-full") => PgSslMode::VerifyFull,
                Some("prefer") => PgSslMode::Prefer,
                _ => PgSslMode::Disable,
            };
            opts = opts.ssl_mode(mode);

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
            .connect_with(opts).await?;

        let mut pools = self.postgres_pools.lock().await;
        pools.insert(config.id, pool);

        Ok(())
    }

    async fn connect_mysql(&self, config: ConnectionConfig, password: Option<String>) -> Result<()> {
        let mut final_config = config.clone();
        
        if config.ssh_enabled {
            let tunnel = self.establish_ssh_tunnel(&config).await?;
            final_config.host = Some("127.0.0.1".to_string());
            final_config.port = Some(tunnel.local_port);
            
            let mut tunnels = self.tunnels.lock().await;
            tunnels.insert(config.id, tunnel);
        }

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

        if final_config.ssl_enabled {
            let mode = match final_config.ssl_mode.as_deref() {
                Some("require") | Some("verify-ca") | Some("verify-full") => MySqlSslMode::Required,
                _ => MySqlSslMode::Disabled,
            };
            opts = opts.ssl_mode(mode);
            
            if let Some(ca) = &final_config.ssl_ca_path {
                opts = opts.ssl_ca(ca);
            }
        }
        
        let pool = sqlx::mysql::MySqlPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(5))
            .connect_with(opts).await?;

        let mut pools = self.mysql_pools.lock().await;
        pools.insert(config.id, pool);

        Ok(())
    }

    async fn connect_sqlite(&self, config: ConnectionConfig) -> Result<()> {
        let db_path = config.database.clone().ok_or_else(|| anyhow!("Path required for SQLite"))?;
        let url = format!("sqlite:{}", db_path);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_secs(5))
            .connect(&url)
            .await
            .map_err(|e| anyhow!("Failed to connect to SQLite: {}", e))?;

        let mut pools = self.sqlite_pools.lock().await;
        pools.insert(config.id, pool);
        Ok(())
    }

    pub async fn switch_database(&self, id: &Uuid, db_name: &str) -> Result<()> {

        
        let config = {
            let configs = self.configs.lock().await;
            configs.get(id).cloned().ok_or_else(|| anyhow!("Connection config not found"))?
        };
        let password = {
            let passwords = self.passwords.lock().await;
            passwords.get(id).cloned().flatten()
        };

        let mut new_config = config.clone();
        new_config.database = Some(db_name.to_string());

        let result = match new_config.db_type {
            DatabaseType::Postgres => self.connect_postgres(new_config.clone(), password.clone()).await,
            DatabaseType::MySql => self.connect_mysql(new_config.clone(), password.clone()).await,
            DatabaseType::Sqlite => Err(anyhow!("SQLite does not support switching databases within the same file connection.")),
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
        {
            let mut configs = self.configs.lock().await;
            configs.remove(id);
        }
        {
            let mut passwords = self.passwords.lock().await;
            passwords.remove(id);
        }
        {
            let mut pools = self.postgres_pools.lock().await;
            if pools.remove(id).is_some() { return Ok(()); }
        }
        {
            let mut pools = self.mysql_pools.lock().await;
            if pools.remove(id).is_some() { return Ok(()); }
        }
        {
            let mut pools = self.sqlite_pools.lock().await;
            pools.remove(id);
        }
        {
            let mut tunnels = self.tunnels.lock().await;
            if let Some(tunnel) = tunnels.remove(id) {
                let _ = tunnel.task_handle.abort();
            }
        }
        Ok(())
    }

    pub async fn get_postgres_pools(&self) -> tokio::sync::OwnedMutexGuard<HashMap<Uuid, Pool<Postgres>>> {
        self.postgres_pools.clone().lock_owned().await
    }

    pub async fn get_mysql_pools(&self) -> tokio::sync::OwnedMutexGuard<HashMap<Uuid, Pool<MySql>>> {
        self.mysql_pools.clone().lock_owned().await
    }

    pub async fn get_sqlite_pools(&self) -> tokio::sync::OwnedMutexGuard<HashMap<Uuid, Pool<Sqlite>>> {
        self.sqlite_pools.clone().lock_owned().await
    }
}
