use anyhow::{ensure, Context, Result};
use serde::Deserialize;
use std::io::Write;
use std::path::Path;
use tauri::Window;
use tauri_plugin_dialog::DialogExt;
use tempfile::NamedTempFile;

const MAX_EXPORT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QueryExportFormat {
    Csv,
    Json,
}

impl QueryExportFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Json => "json",
        }
    }
}

fn check_size(content: &str) -> Result<()> {
    ensure!(
        content.len() <= MAX_EXPORT_BYTES,
        "Export is too large. Select fewer rows or run a smaller query before exporting."
    );
    Ok(())
}

fn write_export(path: &Path, format: QueryExportFormat, content: &str) -> Result<()> {
    check_size(content)?;
    let extension = format.extension();
    ensure!(
        path.extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case(extension)),
        "Choose a filename ending in .{extension}."
    );
    let parent = path.parent().context("Invalid export destination.")?;
    let mut file = NamedTempFile::new_in(parent)?;
    file.write_all(content.as_bytes())?;
    file.as_file().sync_all()?;
    file.persist(path)?;
    Ok(())
}

#[tauri::command]
pub async fn export_query_results(
    window: Window,
    format: QueryExportFormat,
    content: String,
) -> Result<bool, String> {
    check_size(&content).map_err(|error| error.to_string())?;
    let extension = format.extension();
    let dialog = window
        .dialog()
        .file()
        .set_title("Export Query Results")
        .set_file_name(format!("query-results.{extension}"))
        .add_filter(extension.to_ascii_uppercase(), &[extension]);
    #[cfg(desktop)]
    let dialog = dialog.set_parent(&window);

    let (sender, receiver) = tokio::sync::oneshot::channel();
    dialog.save_file(move |destination| {
        let _ = sender.send(destination);
    });
    let Some(destination) = receiver
        .await
        .map_err(|_| "Could not open the Save dialog.")?
    else {
        return Ok(false);
    };
    let path = destination
        .into_path()
        .map_err(|_| "Choose a local export file.")?;
    tokio::task::spawn_blocking(move || write_export(&path, format, &content))
        .await
        .map_err(|_| "Could not finish saving query results.")?
        .map_err(|error| format!("Could not save query results: {error}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn writes_utf8_and_replaces_a_chooser_approved_export() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("results.JSON");
        fs::write(&path, "previous export").unwrap();
        let content = "[{\"city\":\"Z\u{00fc}rich\"}]\n";
        write_export(&path, QueryExportFormat::Json, content).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn refuses_to_replace_a_file_with_the_wrong_extension() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("database.db");
        fs::write(&path, "keep me").unwrap();
        assert!(write_export(&path, QueryExportFormat::Csv, "id\r\n").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "keep me");
    }

    #[test]
    fn failed_save_removes_the_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("directory.csv");
        fs::create_dir(&path).unwrap();
        assert!(write_export(&path, QueryExportFormat::Csv, "id\r\n").is_err());
        assert!(path.is_dir());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
