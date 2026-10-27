use serde_json::json;
use sqlmate_db_lib::core::connection_manager::ConnectionManager;
use sqlmate_db_lib::core::relationships::get_relationships;
use sqlmate_db_lib::core::ConnectionConfig;
use sqlx::{ConnectOptions, Executor};
use uuid::Uuid;

#[tokio::test]
async fn sqlite_relationships_group_composite_keys_and_resolve_implicit_targets() {
    let id = Uuid::new_v4();
    let path = std::env::temp_dir().join(format!("sqlmate-relationships-{id}.db"));
    let mut setup = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .connect()
        .await
        .unwrap();
    setup
        .execute(
            "CREATE TABLE accounts (tenant_id INTEGER, id INTEGER, PRIMARY KEY (tenant_id, id))",
        )
        .await
        .unwrap();
    setup.execute("CREATE TABLE orders (tenant_id INTEGER, account_id INTEGER, FOREIGN KEY (tenant_id, account_id) REFERENCES accounts)").await.unwrap();
    drop(setup);

    let config: ConnectionConfig = serde_json::from_value(json!({
        "id": id, "name": "test", "db_type": "Sqlite",
        "database": path.to_string_lossy(), "ssl_enabled": false,
        "ssh_enabled": false
    }))
    .unwrap();
    let manager = ConnectionManager::new();
    manager.connect(config, None).await.unwrap();

    let relationships = get_relationships(&manager, &id).await.unwrap();
    let orders = relationships
        .iter()
        .find(|edge| edge.source_table == "orders")
        .unwrap();
    assert_eq!(orders.source_columns, ["tenant_id", "account_id"]);
    assert_eq!(orders.target_table, "accounts");
    assert_eq!(orders.target_columns, ["tenant_id", "id"]);
    assert_eq!(orders.source_schema, None);
    assert_eq!(orders.target_schema, None);

    manager.disconnect(&id).await.unwrap();
    std::fs::remove_file(path).unwrap();
}
