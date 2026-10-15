use crate::core::ai_credentials::valid_model_id;
use crate::core::ai_credentials::AiProviderId;
use serde_json::{json, Value};

const MAX_REQUEST_BYTES: usize = 128 * 1024;
pub const MAX_RESPONSE_BYTES: usize = 2_000_000;
const MAX_ANSWER_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiAuthentication {
    Bearer,
    ApiKeyHeader(&'static str),
}

pub struct AiProviderRequest {
    pub provider: AiProviderId,
    pub model: String,
    pub destination: String,
    pub body: Vec<u8>,
    pub authentication: AiAuthentication,
    pub extra_headers: &'static [(&'static str, &'static str)],
}

pub fn default_model(provider: AiProviderId) -> &'static str {
    match provider {
        AiProviderId::Gemini => "gemini-3.8-flash",
        AiProviderId::Groq => "openai/gpt-oss-120b",
        AiProviderId::Anthropic => "claude-sonnet-5-5",
        AiProviderId::Openai => "gpt-6-luna",
    }
}

pub fn build_request(
    provider: AiProviderId,
    model: &str,
    system: &str,
    user: &str,
) -> Result<AiProviderRequest, String> {
    build_request_with_limit(provider, model, system, user, 2048)
}

pub fn build_test_request(
    provider: AiProviderId,
    model: &str,
) -> Result<AiProviderRequest, String> {
    build_request_with_limit(
        provider,
        model,
        "Connection test. Reply with OK only.",
        "Connection test. Reply OK.",
        128,
    )
}

fn build_request_with_limit(
    provider: AiProviderId,
    model: &str,
    system: &str,
    user: &str,
    max_tokens: u16,
) -> Result<AiProviderRequest, String> {
    if !valid_model_id(model) || (provider == AiProviderId::Gemini && model.contains('/')) {
        return Err("Enter a valid model ID".to_string());
    }
    let (destination, authentication, extra_headers, body) = match provider {
        AiProviderId::Gemini => (
            format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            ),
            AiAuthentication::ApiKeyHeader("x-goog-api-key"),
            &[][..],
            json!({
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "generationConfig": {"maxOutputTokens": max_tokens}
            }),
        ),
        AiProviderId::Groq => (
            "https://api.groq.com/openai/v1/chat/completions".to_string(),
            AiAuthentication::Bearer,
            &[][..],
            json!({
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user}
                ],
                "max_completion_tokens": max_tokens
            }),
        ),
        AiProviderId::Anthropic => (
            "https://api.anthropic.com/v1/messages".to_string(),
            AiAuthentication::ApiKeyHeader("x-api-key"),
            &[("anthropic-version", "2023-06-01")][..],
            json!({
                "model": model,
                "max_tokens": max_tokens,
                "system": system,
                "messages": [{"role": "user", "content": user}]
            }),
        ),
        AiProviderId::Openai => (
            "https://api.openai.com/v1/responses".to_string(),
            AiAuthentication::Bearer,
            &[][..],
            json!({
                "model": model,
                "instructions": system,
                "input": user,
                "max_output_tokens": max_tokens,
                "store": false
            }),
        ),
    };
    let body = serde_json::to_vec(&body).map_err(|_| "Could not prepare AI request".to_string())?;
    if body.len() > MAX_REQUEST_BYTES {
        return Err("AI request is too large. Remove some schema context and retry.".to_string());
    }
    Ok(AiProviderRequest {
        provider,
        model: model.to_string(),
        destination,
        body,
        authentication,
        extra_headers,
    })
}

pub fn parse_response(provider: AiProviderId, bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("AI response was too large".to_string());
    }
    let response: Value = serde_json::from_slice(bytes)
        .map_err(|_| "AI provider returned an invalid response".to_string())?;
    if provider == AiProviderId::Openai
        && response["status"]
            .as_str()
            .is_some_and(|status| status != "completed")
    {
        return Err("OpenAI did not complete the response".to_string());
    }
    let parts: Vec<&str> = match provider {
        AiProviderId::Gemini => response["candidates"][0]["content"]["parts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|part| part["thought"] != true)
            .filter_map(|part| part["text"].as_str())
            .collect(),
        AiProviderId::Groq => response["choices"][0]["message"]["content"]
            .as_str()
            .into_iter()
            .collect(),
        AiProviderId::Anthropic => response["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|part| part["type"] == "text")
            .filter_map(|part| part["text"].as_str())
            .collect(),
        AiProviderId::Openai => response["output"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|item| item["type"] == "message" && item["role"] == "assistant")
            .filter_map(|item| item["content"].as_array())
            .flatten()
            .filter(|part| part["type"] == "output_text")
            .filter_map(|part| part["text"].as_str())
            .collect(),
    };
    let answer = parts.join("\n");
    let answer = answer.trim();
    if answer.is_empty() {
        return Err("AI provider returned no text".to_string());
    }
    if answer.len() > MAX_ANSWER_BYTES {
        return Err("AI answer was too large".to_string());
    }
    Ok(answer.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn each_provider_has_a_fixed_https_destination_and_distinct_auth_metadata() {
        let cases = [
            (
                AiProviderId::Gemini,
                "generativelanguage.googleapis.com",
                AiAuthentication::ApiKeyHeader("x-goog-api-key"),
            ),
            (AiProviderId::Groq, "api.groq.com", AiAuthentication::Bearer),
            (
                AiProviderId::Anthropic,
                "api.anthropic.com",
                AiAuthentication::ApiKeyHeader("x-api-key"),
            ),
            (
                AiProviderId::Openai,
                "api.openai.com",
                AiAuthentication::Bearer,
            ),
        ];
        for (provider, host, authentication) in cases {
            let request =
                build_request(provider, default_model(provider), "system", "user").unwrap();
            assert!(request.destination.starts_with(&format!("https://{host}/")));
            assert_eq!(request.authentication, authentication);
            let body = String::from_utf8(request.body).unwrap();
            assert!(!body.contains("secret-api-key"));
        }
    }

    #[test]
    fn provider_test_sends_only_a_small_fixed_prompt() {
        for provider in AiProviderId::ALL {
            let request = build_test_request(provider, default_model(provider)).unwrap();
            let body = String::from_utf8(request.body).unwrap();
            assert!(body.contains("Connection test"));
            assert!(!body.contains("SCHEMA METADATA"));
            assert!(!body.contains("secret-api-key"));
            assert!(body.len() < 1024);
        }
    }

    #[test]
    fn request_bodies_match_each_provider_wire_format() {
        let body = |provider| -> Value {
            let request = build_request(
                provider,
                default_model(provider),
                "system instructions",
                "user prompt",
            )
            .unwrap();
            serde_json::from_slice(&request.body).unwrap()
        };
        let gemini = body(AiProviderId::Gemini);
        assert_eq!(
            gemini["systemInstruction"]["parts"][0]["text"],
            "system instructions"
        );
        assert_eq!(gemini["contents"][0]["parts"][0]["text"], "user prompt");

        let groq = body(AiProviderId::Groq);
        assert_eq!(groq["messages"][0]["role"], "system");
        assert_eq!(groq["messages"][1]["content"], "user prompt");

        let anthropic = body(AiProviderId::Anthropic);
        assert_eq!(anthropic["system"], "system instructions");
        assert_eq!(anthropic["messages"][0]["content"], "user prompt");
        assert!(anthropic["max_tokens"].as_u64().unwrap() > 0);
        let anthropic_request = build_request(
            AiProviderId::Anthropic,
            default_model(AiProviderId::Anthropic),
            "system",
            "user",
        )
        .unwrap();
        assert_eq!(
            anthropic_request.extra_headers,
            &[("anthropic-version", "2023-06-01")]
        );

        let openai = body(AiProviderId::Openai);
        assert_eq!(openai["instructions"], "system instructions");
        assert_eq!(openai["input"], "user prompt");
        assert_eq!(openai["store"], false);
    }

    #[test]
    fn each_provider_extracts_text_without_assuming_first_output_item() {
        let cases = [
            (
                AiProviderId::Gemini,
                json!({"candidates":[{"content":{"parts":[{"thought":true,"text":"hidden"},{"text":"SELECT 1"}]}}]}),
            ),
            (
                AiProviderId::Groq,
                json!({"choices":[{"message":{"content":"SELECT 1"}}]}),
            ),
            (
                AiProviderId::Anthropic,
                json!({"content":[{"type":"thinking","thinking":"hidden"},{"type":"text","text":"SELECT 1"}]}),
            ),
            (
                AiProviderId::Openai,
                json!({"output":[{"type":"reasoning"},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"SELECT 1"}]}]}),
            ),
        ];
        for (provider, response) in cases {
            assert_eq!(
                parse_response(provider, &serde_json::to_vec(&response).unwrap()).unwrap(),
                "SELECT 1"
            );
        }
    }

    #[test]
    fn invalid_models_and_empty_or_oversize_responses_are_rejected() {
        assert!(build_request(AiProviderId::Gemini, "../bad?key=x", "system", "user").is_err());
        assert!(build_request(AiProviderId::Openai, "bad\nheader", "system", "user").is_err());
        assert!(build_request(AiProviderId::Gemini, "other/model", "system", "user").is_err());
        assert!(build_request(AiProviderId::Groq, "openai/gpt-oss-120b", "system", "user").is_ok());
        for provider in AiProviderId::ALL {
            assert!(parse_response(provider, b"{}").is_err());
            assert!(parse_response(provider, &vec![b'x'; 2_000_001]).is_err());
        }
    }
}
