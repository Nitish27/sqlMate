use serde_json::json;

const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/chat/completions";

/// Calls Groq API to convert natural language to SQL.
/// Returns the raw SQL string on success.
pub async fn generate_sql(
    api_key: &str,
    prompt: &str,
    schema_context: &str,
    db_type: &str,
) -> Result<String, String> {
    let system_prompt = format!(
        "You are an expert {} SQL query generator. \
         Given the database schema below, convert the user's natural language request into a valid SQL query.\n\n\
         RULES:\n\
         - Output ONLY the raw SQL query, nothing else\n\
         - No markdown formatting, no code fences, no explanations\n\
         - Use the exact table and column names from the schema\n\
         - Write syntactically correct {} SQL\n\n\
         DATABASE SCHEMA:\n{}",
        db_type, db_type, schema_context
    );

    let request_body = json!({
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.1,
        "max_tokens": 1024
    });

    let client = reqwest::Client::new();
    let response = client
        .post(GROQ_API_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to call Groq API: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        
        // Try to parse the specific Groq error message
        if let Ok(error_json) = serde_json::from_str::<serde_json::Value>(&body) {
            if let Some(msg) = error_json.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
                if status == 429 {
                    return Err(format!("API Quota Exceeded.\n\n{}", msg));
                }
                return Err(format!("AI Error: {}", msg));
            }
        }
        
        return Err(format!("API error ({}): {}", status, body));
    }

    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Groq response: {}", e))?;

    // Extract text from choices[0].message.content
    let sql = response_json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| "No SQL generated in Groq response".to_string())?;

    // Strip any accidental markdown code fences
    let cleaned = sql
        .trim()
        .trim_start_matches("```sql")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();

    Ok(cleaned)
}
