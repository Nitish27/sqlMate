use serde_json::json;
use sqlmate_db_lib::core::connection_manager::ConnectionManager;
use sqlmate_db_lib::core::data_compare::{get_comparison_rows, PrimaryKeyRange};
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
        .execute("INSERT INTO items VALUES (3, 'third'), (1, 'first'), (2, NULL), (10, 'tenth'), (9007199254740993, 'large')")
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

    let first = get_comparison_rows(&manager, &id, None, "items".into(), 2, None)
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

    let all = get_comparison_rows(&manager, &id, None, "items".into(), 5, None)
        .await
        .unwrap();
    assert_eq!(all.rows.len(), 5);
    assert_eq!(all.rows[3][0].as_deref(), Some("10"));
    assert!(!all.has_more);

    let compare_range = |lower: Option<&str>, upper: Option<&str>, limit| {
        get_comparison_rows(
            &manager,
            &id,
            None,
            "items".into(),
            limit,
            Some(PrimaryKeyRange {
                column: "id".into(),
                lower: lower.map(str::to_owned),
                upper: upper.map(str::to_owned),
            }),
        )
    };
    let bounded = compare_range(Some("2"), Some("3"), 2).await.unwrap();
    assert_eq!(
        bounded.rows,
        [
            vec![Some("2".into()), None],
            vec![Some("3".into()), Some("third".into())]
        ]
    );
    assert!(!bounded.has_more);
    let limited = compare_range(Some("2"), Some("3"), 1).await.unwrap();
    assert_eq!(limited.rows.len(), 1);
    assert!(limited.has_more);
    let ordered = compare_range(Some("2"), Some("10"), 2).await.unwrap();
    assert_eq!(ordered.rows, bounded.rows);
    assert!(ordered.has_more);
    let upper_only = compare_range(None, Some("1"), 2).await.unwrap();
    assert_eq!(upper_only.rows.len(), 1);
    assert!(!upper_only.has_more);
    let lower_only = compare_range(Some("9007199254740993"), None, 2)
        .await
        .unwrap();
    assert_eq!(lower_only.rows[0][0].as_deref(), Some("9007199254740993"));
    assert!(!lower_only.has_more);
    assert!(compare_range(Some("3"), Some("2"), 2).await.is_err());

    assert!(
        get_comparison_rows(&manager, &id, None, "no_key".into(), 2, None)
            .await
            .is_err()
    );
    assert!(get_comparison_rows(
        &manager,
        &id,
        None,
        "items; DELETE FROM items".into(),
        2,
        None
    )
    .await
    .is_err());
    assert!(
        get_comparison_rows(&manager, &id, None, "items".into(), 201, None)
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
    assert!(
        get_comparison_rows(&manager, &id, None, "items".into(), 4, None)
            .await
            .unwrap_err()
            .to_string()
            .contains("too large")
    );

    manager.disconnect(&id).await.unwrap();
    std::fs::remove_file(path).unwrap();
}
