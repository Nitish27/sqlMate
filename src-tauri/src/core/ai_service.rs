use serde_json::{json, Value};
use std::time::Duration;

const GEMINI_API_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/chat/completions";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Gemini,
    Groq,
}

impl Provider {
    pub fn label(self) -> &'static str {
        match self {
            Self::Gemini => "Gemini",
            Self::Groq => "Groq",
        }
    }
}

pub fn select_provider(
    gemini_key: Option<&str>,
    groq_key: Option<&str>,
    preferred: Option<&str>,
) -> Result<Provider, String> {
    let has_gemini = gemini_key.is_some_and(|key| !key.trim().is_empty());
    let has_groq = groq_key.is_some_and(|key| !key.trim().is_empty());
    match preferred
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("gemini") if has_gemini => Ok(Provider::Gemini),
        Some("groq") if has_groq => Ok(Provider::Groq),
        Some("gemini") => Err("SQLMATE_AI_PROVIDER=gemini requires GEMINI_API_KEY".to_string()),
        Some("groq") => Err("SQLMATE_AI_PROVIDER=groq requires GROQ_API_KEY".to_string()),
        Some(_) => Err("SQLMATE_AI_PROVIDER must be gemini or groq".to_string()),
        None if has_gemini => Ok(Provider::Gemini),
        None if has_groq => Ok(Provider::Groq),
        None => {
            Err("Add GEMINI_API_KEY or GROQ_API_KEY to your .env, then restart SqlMate".to_string())
        }
    }
}

fn sql_system_prompt(schema_context: &str, db_type: &str) -> String {
    format!(
        "You are an expert {} SQL query generator. \
         Given the database schema below, convert the user's natural language request into a valid SQL query.\n\n\
         RULES:\n\
         - Output ONLY the raw SQL query, nothing else\n\
         - No markdown formatting, no code fences, no explanations\n\
         - Use the exact table and column names from the schema\n\
         - Write syntactically correct {} SQL\n\
         - Never invent table or column names\n\n\
         DATABASE SCHEMA:\n{}",
        db_type, db_type, schema_context
    )
}

fn build_gemini_request(prompt: &str, schema_context: &str, db_type: &str) -> Value {
    json!({
        "systemInstruction": { "parts": [{ "text": sql_system_prompt(schema_context, db_type) }] },
        "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
        "generationConfig": { "maxOutputTokens": 2048 }
    })
}

fn build_groq_request(prompt: &str, schema_context: &str, db_type: &str) -> Value {
    json!({
        "model": "openai/gpt-oss-120b",
        "messages": [
            { "role": "system", "content": sql_system_prompt(schema_context, db_type) },
            { "role": "user", "content": prompt }
        ],
        "reasoning_effort": "low",
        "include_reasoning": false,
        "max_completion_tokens": 2048
    })
}

fn clean_sql(sql: &str) -> Result<String, String> {
    let cleaned = sql
        .trim()
        .trim_start_matches("```sql")
        .trim_start_matches("```SQL")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();
    if cleaned.is_empty() {
        Err("The AI provider returned no SQL. Try a more specific request.".to_string())
    } else {
        Ok(cleaned)
    }
}

fn parse_gemini_sql(response: &Value) -> Result<String, String> {
    let parts = response["candidates"][0]["content"]["parts"]
        .as_array()
        .ok_or("Gemini returned no SQL. Try a more specific request.")?;
    let sql = parts
        .iter()
        .filter(|part| part["thought"] != true)
        .filter_map(|part| part["text"].as_str())
        .collect::<String>();
    clean_sql(&sql)
}

fn parse_groq_sql(response: &Value) -> Result<String, String> {
    let sql = response["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Groq returned no SQL. Try a more specific request.")?;
    clean_sql(sql)
}

/// Sends only the user's request and schema metadata; never database rows or credentials.
pub async fn generate_sql(
    provider: Provider,
    api_key: &str,
    prompt: &str,
    schema_context: &str,
    db_type: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "Could not initialize AI client".to_string())?;
    let request = match provider {
        Provider::Gemini => client
            .post(GEMINI_API_URL)
            .header("x-goog-api-key", api_key)
            .json(&build_gemini_request(prompt, schema_context, db_type)),
        Provider::Groq => client
            .post(GROQ_API_URL)
            .bearer_auth(api_key)
            .json(&build_groq_request(prompt, schema_context, db_type)),
    };
    let response = request
        .send()
        .await
        .map_err(|e| format!("Could not reach {}: {}", provider.label(), e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        let message = body["error"]["message"]
            .as_str()
            .unwrap_or("Request failed");
        if status == 429 {
            return Err(format!("{} quota exceeded. {}", provider.label(), message));
        }
        return Err(format!(
            "{} error ({}): {}",
            provider.label(),
            status,
            message
        ));
    }

    let response_json: Value = response
        .json()
        .await
        .map_err(|_| format!("Could not read {} response", provider.label()))?;
    match provider {
        Provider::Gemini => parse_gemini_sql(&response_json),
        Provider::Groq => parse_groq_sql(&response_json),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gemini_request_contains_schema_and_prompt() {
        let request =
            build_gemini_request("show latest admins", "TABLE admins:\n id bigint", "MySQL");
        assert!(request["systemInstruction"]["parts"][0]["text"]
            .as_str()
            .unwrap()
            .contains("TABLE admins:\n id bigint"));
        assert_eq!(
            request["contents"][0]["parts"][0]["text"],
            "show latest admins"
        );
        assert!(request.get("messages").is_none());
    }

    #[test]
    fn gemini_response_extracts_sql_without_markdown() {
        let response = json!({"candidates": [{"content": {"parts": [
            {"text": "```sql\nSELECT * FROM admins ORDER BY created_at DESC LIMIT 5;\n```"}
        ]}}]});
        assert_eq!(
            parse_gemini_sql(&response).unwrap(),
            "SELECT * FROM admins ORDER BY created_at DESC LIMIT 5;"
        );
    }

    #[test]
    fn gemini_response_rejects_missing_or_empty_sql() {
        assert!(parse_gemini_sql(&json!({"candidates": []})).is_err());
        assert!(
            parse_gemini_sql(&json!({"candidates": [{"content": {"parts": [
                {"text": "  "}
            ]}}]}))
            .is_err()
        );
    }

    #[test]
    fn groq_request_uses_current_model_and_sql_prompt() {
        let request = build_groq_request("show admins", "TABLE admins", "MySQL");
        assert_eq!(request["model"], "openai/gpt-oss-120b");
        assert_eq!(request["reasoning_effort"], "low");
        assert_eq!(request["include_reasoning"], false);
        assert_eq!(request["messages"][1]["content"], "show admins");
        assert!(request["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("TABLE admins"));
    }

    #[test]
    fn groq_response_extracts_sql() {
        let response = json!({"choices": [{"message": {"content": "SELECT * FROM admins;"}}]});
        assert_eq!(parse_groq_sql(&response).unwrap(), "SELECT * FROM admins;");
    }

    #[test]
    fn provider_selection_uses_available_key_and_respects_preference() {
        assert_eq!(
            select_provider(Some("gemini"), None, None).unwrap(),
            Provider::Gemini
        );
        assert_eq!(
            select_provider(None, Some("groq"), None).unwrap(),
            Provider::Groq
        );
        assert_eq!(
            select_provider(Some("gemini"), Some("groq"), None).unwrap(),
            Provider::Gemini
        );
        assert_eq!(
            select_provider(Some("gemini"), Some("groq"), Some("groq")).unwrap(),
            Provider::Groq
        );
        assert!(select_provider(Some("gemini"), None, Some("groq")).is_err());
        assert!(select_provider(None, None, None).is_err());
        assert!(select_provider(Some("gemini"), None, Some("unknown")).is_err());
    }
}
