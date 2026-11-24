fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

pub fn encode(schema: &str, table: &str) -> String {
    format!("{}.{}", quote(schema), quote(table))
}

fn read_identifier(input: &str) -> Option<(String, &str)> {
    let input = input.strip_prefix('"')?;
    let mut value = String::new();
    let mut chars = input.char_indices().peekable();
    while let Some((index, ch)) = chars.next() {
        if ch == '"' {
            if chars.peek().is_some_and(|(_, next)| *next == '"') {
                chars.next();
            } else {
                return (!value.is_empty()).then_some((value, &input[index + 1..]));
            }
        }
        value.push(ch);
    }
    None
}

// Legacy workspace entries and plain CSV input name tables in public.
pub fn parts(reference: &str) -> (String, String) {
    if let Some((schema, rest)) = read_identifier(reference) {
        if let Some((table, "")) = rest.strip_prefix('.').and_then(read_identifier) {
            return (schema, table);
        }
    }
    ("public".into(), reference.into())
}

pub fn sql(reference: &str) -> String {
    let (schema, table) = parts(reference);
    encode(&schema, &table)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_schema_and_identifier_boundaries() {
        for schema in ["public", "billing", "sales", "with.\"dots"] {
            let reference = encode(schema, "orders.\"archive");
            assert_eq!(parts(&reference), (schema.into(), "orders.\"archive".into()));
            assert_eq!(sql(&reference), reference);
        }
        assert_eq!(sql("orders"), "\"public\".\"orders\"");
        assert_eq!(parts("sales.orders"), ("public".into(), "sales.orders".into()));
    }
}
