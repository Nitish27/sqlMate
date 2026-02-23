pub mod csv_importer;
pub mod sql_importer;

use serde::{Serialize};

#[derive(Serialize, Clone)]
pub struct ImportProgress {
    pub import_id: String,
    pub rows_processed: u64,
    pub total_rows: Option<u64>,
    pub percentage: Option<f32>,
    pub status: String, // "processing" | "complete" | "error"
    pub error: Option<String>,
}

pub enum InsertTarget {
    Postgres(sqlx::PgPool),
    MySql(sqlx::MySqlPool),
    Sqlite(sqlx::SqlitePool),
}
