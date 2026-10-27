use serde_json::json;
use sqlmate_db_lib::core::connection_manager::ConnectionManager;
use sqlmate_db_lib::core::data_compare::get_comparison_rows;
use sqlmate_db_lib::core::ConnectionConfig;
use sqlx::{ConnectOptions, Executor};
use uuid::Uuid;

#[tokio::test]
async fn sqlite_comparison_reads_a_bounded_ordered_sample() {
    let id = Uuid::new_v4();
    let path = std::env::temp_dir().join(format!("sqlmate-data-compare-{id}.db"));
    let mut setup = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .connect()
        .await
        .unwrap();
    setup
        .execute("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)")
        .await
        .unwrap();
    setup
        .execute("INSERT INTO items VALUES (3, 'third'), (1, 'first'), (2, NULL)")
        .await
        .unwrap();
    setup
        .execute("CREATE TABLE no_key (label TEXT)")
        .await
        .unwrap();
    drop(setup);

    let config: ConnectionConfig = serde_json::from_value(json!({
        "id": id, "name": "compare test", "db_type": "Sqlite",
        "database": path.to_string_lossy(), "ssl_enabled": false, "ssh_enabled": false
    }))
    .unwrap();
    let manager = ConnectionManager::new();
    manager.connect(config, None).await.unwrap();

    let first = get_comparison_rows(&manager, &id, None, "items".into(), 2)
        .await
        .unwrap();
    assert_eq!(first.columns, ["id", "label"]);
    assert_eq!(first.primary_key, ["id"]);
    assert_eq!(
        first.rows,
        [
            vec![Some("1".into()), Some("first".into())],
            vec![Some("2".into()), None]
        ]
    );
    assert!(first.has_more);

    let all = get_comparison_rows(&manager, &id, None, "items".into(), 3)
        .await
        .unwrap();
    assert_eq!(all.rows.len(), 3);
    assert!(!all.has_more);
    assert!(get_comparison_rows(&manager, &id, None, "no_key".into(), 2)
        .await
        .is_err());
    assert!(
        get_comparison_rows(&manager, &id, None, "items; DELETE FROM items".into(), 2)
            .await
            .is_err()
    );
    assert!(
        get_comparison_rows(&manager, &id, None, "items".into(), 201)
            .await
            .is_err()
    );

    let mut writer = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&path)
        .connect()
        .await
        .unwrap();
    writer
        .execute("INSERT INTO items VALUES (4, hex(zeroblob(5000)))")
        .await
        .unwrap();
    drop(writer);
    assert!(get_comparison_rows(&manager, &id, None, "items".into(), 4)
        .await
        .unwrap_err()
        .to_string()
        .contains("too large"));

    manager.disconnect(&id).await.unwrap();
    std::fs::remove_file(path).unwrap();
}
