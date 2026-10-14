pub fn validate_read_only_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim();
    let statement = trimmed.strip_suffix(';').unwrap_or(trimmed).trim_end();
    if statement.contains(';') {
        return Err("Safe mode runs one SELECT statement at a time".to_string());
    }

    let words: Vec<String> = statement
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .filter(|word| !word.is_empty())
        .map(str::to_ascii_uppercase)
        .collect();

    if words.first().map(String::as_str) != Some("SELECT")
        || !statement
            .get(..6)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("SELECT"))
    {
        return Err("Safe mode currently allows only a single SELECT statement".to_string());
    }
    if words.iter().any(|word| {
        matches!(
            word.as_str(),
            "INTO" | "OUTFILE" | "DUMPFILE" | "LOAD_FILE" | "LOCK" | "FOR"
        )
    }) || words
        .windows(2)
        .any(|pair| pair[0] == "FOR" && pair[1] == "UPDATE")
    {
        return Err(
            "Safe mode blocks SELECT statements with write or lock side effects".to_string(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_read_only_sql;

    #[test]
    fn accepts_a_single_select() {
        assert!(validate_read_only_sql("SELECT id FROM users WHERE id = 1;").is_ok());
        assert!(validate_read_only_sql("select count(*) from users").is_ok());
    }

    #[test]
    fn rejects_writes_and_ambiguous_statements() {
        for sql in [
            "DELETE FROM users",
            "WITH deleted AS (DELETE FROM users RETURNING *) SELECT * FROM deleted",
            "SELECT * FROM users; DELETE FROM users",
            "SELECT * FROM users INTO OUTFILE '/tmp/users'",
            "SELECT * FROM users FOR UPDATE",
            "SELECT * FROM users; -- trailing comment",
        ] {
            assert!(validate_read_only_sql(sql).is_err(), "{sql}");
        }
    }
}
