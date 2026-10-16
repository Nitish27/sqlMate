use crate::core::read_only_sql::validate_read_only_sql;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum ParameterValue {
    Text(String),
    Integer(i64),
    Float(f64),
    Boolean(bool),
    Null,
}

#[derive(Clone, Debug, Deserialize)]
pub struct QueryParameter {
    pub name: String,
    pub value: ParameterValue,
}

#[derive(Clone, Copy)]
pub enum DatabaseDialect {
    Postgres,
    MySql,
    Sqlite,
}

pub struct CompiledQuery {
    pub sql: String,
    pub values: Vec<ParameterValue>,
}

fn identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn identifier_part(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

pub fn compile_query(
    sql: &str,
    parameters: &[QueryParameter],
    dialect: DatabaseDialect,
) -> Result<CompiledQuery, String> {
    let mut provided = HashMap::new();
    for parameter in parameters {
        if parameter.name.is_empty()
            || !identifier_start(parameter.name.as_bytes()[0])
            || !parameter.name.bytes().all(identifier_part)
            || provided
                .insert(parameter.name.as_str(), &parameter.value)
                .is_some()
        {
            return Err("Invalid or duplicate query parameter name".into());
        }
    }

    let bytes = sql.as_bytes();
    let mut output = String::with_capacity(sql.len());
    let mut validation = String::with_capacity(sql.len());
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();
    let mut positions = HashMap::new();
    let mut index = 0;
    let mut output_cursor = 0;
    let mut validation_cursor = 0;

    while index < bytes.len() {
        let byte = bytes[index];
        let next = bytes.get(index + 1).copied();
        let start = index;
        let (end, masked) = if byte == b'\'' || byte == b'"' || byte == b'`' {
            index += 1;
            while index < bytes.len() {
                if bytes[index] == b'\\' {
                    index = (index + 2).min(bytes.len());
                    continue;
                }
                if bytes[index] == byte {
                    index += 1;
                    if bytes.get(index) == Some(&byte) {
                        index += 1;
                        continue;
                    }
                    break;
                }
                index += 1;
            }
            (index, true)
        } else if (byte == b'-' && next == Some(b'-')) || byte == b'#' {
            index += if byte == b'-' { 2 } else { 1 };
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            (index, true)
        } else if byte == b'/' && next == Some(b'*') {
            index += 2;
            let mut depth = 1;
            while index + 1 < bytes.len() && depth > 0 {
                if bytes[index] == b'/' && bytes[index + 1] == b'*' {
                    depth += 1;
                    index += 2;
                } else if bytes[index] == b'*' && bytes[index + 1] == b'/' {
                    depth -= 1;
                    index += 2;
                } else {
                    index += 1;
                }
            }
            if depth > 0 {
                index = bytes.len();
            }
            (index, true)
        } else if byte == b'$' {
            let mut tag_end = index + 1;
            while tag_end < bytes.len() && identifier_part(bytes[tag_end]) {
                tag_end += 1;
            }
            if bytes.get(tag_end) == Some(&b'$')
                && (tag_end == index + 1 || identifier_start(bytes[index + 1]))
            {
                let tag = &sql[index..=tag_end];
                index = tag_end + 1;
                if let Some(close) = sql[index..].find(tag) {
                    index += close + tag.len();
                } else {
                    index = bytes.len();
                }
                (index, true)
            } else {
                index += 1;
                (index, false)
            }
        } else if byte == b':'
            && bytes.get(index.wrapping_sub(1)) != Some(&b':')
            && next != Some(b':')
            && next.is_some_and(identifier_start)
        {
            let mut end = index + 2;
            while end < bytes.len() && identifier_part(bytes[end]) {
                end += 1;
            }
            let name = &sql[index + 1..end];
            let value = provided
                .get(name)
                .ok_or_else(|| format!("Missing value for :{name}"))?;
            output.push_str(&sql[output_cursor..index]);
            validation.push_str(&sql[validation_cursor..index]);
            let placeholder = match dialect {
                DatabaseDialect::Postgres => {
                    let number = *positions.entry(name).or_insert_with(|| {
                        ordered.push((*value).clone());
                        ordered.len()
                    });
                    format!("${number}")
                }
                _ => {
                    ordered.push((*value).clone());
                    "?".into()
                }
            };
            output.push_str(&placeholder);
            validation.push_str(&placeholder);
            seen.insert(name);
            index = end;
            output_cursor = end;
            validation_cursor = end;
            continue;
        } else {
            index += 1;
            (index, false)
        };
        if masked {
            validation.push_str(&sql[validation_cursor..start]);
            validation.extend(std::iter::repeat_n(' ', end - start));
            validation_cursor = end;
        }
    }
    output.push_str(&sql[output_cursor..]);
    validation.push_str(&sql[validation_cursor..]);
    if seen.len() != provided.len() || seen.is_empty() {
        return Err("Query parameters must match the placeholders in this SELECT".into());
    }
    validate_read_only_sql(&validation)?;
    Ok(CompiledQuery {
        sql: output,
        values: ordered,
    })
}

#[cfg(test)]
mod tests {
    use super::{compile_query, DatabaseDialect, ParameterValue, QueryParameter};
    use sqlx::{Connection, Row};

    fn param(name: &str, value: ParameterValue) -> QueryParameter {
        QueryParameter {
            name: name.into(),
            value,
        }
    }

    #[test]
    fn compiles_repeated_names_for_each_dialect() {
        let sql = "SELECT * FROM users WHERE id = :id OR manager_id = :id";
        let values = [param("id", ParameterValue::Integer(7))];
        let pg = compile_query(sql, &values, DatabaseDialect::Postgres).unwrap();
        assert_eq!(
            pg.sql,
            "SELECT * FROM users WHERE id = $1 OR manager_id = $1"
        );
        assert_eq!(pg.values.len(), 1);
        let mysql = compile_query(sql, &values, DatabaseDialect::MySql).unwrap();
        assert_eq!(
            mysql.sql,
            "SELECT * FROM users WHERE id = ? OR manager_id = ?"
        );
        assert_eq!(mysql.values.len(), 2);
    }

    #[test]
    fn ignores_literals_comments_and_casts() {
        let sql = "SELECT ':fake', \"x:fake\", :id::int, $$:fake$$ /* :fake */ -- :fake\n";
        let result = compile_query(
            sql,
            &[param("id", ParameterValue::Integer(3))],
            DatabaseDialect::Postgres,
        )
        .unwrap();
        assert!(result.sql.contains("$1::int"));
        assert!(result.sql.contains("$$:fake$$"));
    }

    #[test]
    fn ignores_nested_block_comments() {
        let sql = "SELECT /* outer /* :ignored */ still :ignored */ :active";
        let result = compile_query(
            sql,
            &[param("active", ParameterValue::Integer(1))],
            DatabaseDialect::Postgres,
        )
        .unwrap();
        assert!(result.sql.ends_with("$1"));
    }

    #[test]
    fn rejects_missing_or_extra_values_and_writes() {
        let sql = "SELECT * FROM users WHERE id = :id";
        assert!(compile_query(sql, &[], DatabaseDialect::Postgres).is_err());
        assert!(compile_query(
            sql,
            &[
                param("id", ParameterValue::Integer(1)),
                param("extra", ParameterValue::Null)
            ],
            DatabaseDialect::Postgres
        )
        .is_err());
        assert!(compile_query(
            "DELETE FROM users WHERE id = :id",
            &[param("id", ParameterValue::Integer(1))],
            DatabaseDialect::Postgres
        )
        .is_err());
        assert!(compile_query(
            "SELECT * FROM users WHERE id = :id; DELETE FROM users",
            &[param("id", ParameterValue::Integer(1))],
            DatabaseDialect::Postgres
        )
        .is_err());
    }

    #[tokio::test]
    async fn sqlite_binds_values_instead_of_running_them_as_sql() {
        let mut connection = sqlx::SqliteConnection::connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE items (id INTEGER, label TEXT)")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO items VALUES (1, 'safe')")
            .execute(&mut connection)
            .await
            .unwrap();
        let compiled = compile_query(
            "SELECT id FROM items WHERE label = :label",
            &[param("label", ParameterValue::Text("' OR 1=1 --".into()))],
            DatabaseDialect::Sqlite,
        )
        .unwrap();
        let rows = sqlx::query(&compiled.sql)
            .bind("' OR 1=1 --")
            .fetch_all(&mut connection)
            .await
            .unwrap();
        assert!(rows.is_empty());
        let compiled = compile_query(
            "SELECT label FROM items WHERE id = :id OR id = :id",
            &[param("id", ParameterValue::Integer(1))],
            DatabaseDialect::Sqlite,
        )
        .unwrap();
        assert_eq!(compiled.values.len(), 2);
        let rows = sqlx::query(&compiled.sql)
            .bind(1_i64)
            .bind(1_i64)
            .fetch_all(&mut connection)
            .await
            .unwrap();
        assert_eq!(rows[0].get::<String, _>(0), "safe");
    }
}
