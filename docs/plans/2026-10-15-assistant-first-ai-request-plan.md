# Plan: Assistant Request Boundary

**Goal:** Prepare and send one explicitly reviewed AI request without leaking keys or executing SQL.
**Requires:** `2026-10-15-assistant-first-ai-foundations-plan.md`
**Context budget:** Two tasks; checkpoint before the assistant UI plan.

## Task 3: Four provider adapters

**Files:** Create `src-tauri/src/core/ai_adapters.rs`; modify `src-tauri/src/core/mod.rs`.

Build typed Gemini, Groq, Anthropic, and OpenAI adapters. Each adapter owns a fixed HTTPS destination, default model, provider-specific JSON body, authentication header name, and response parser. Keep the model configurable but validate it before constructing a URL or body. Serialize the outbound body once to bytes, and keep that byte buffer available for later review/send parity. Normalize text answers without assuming the first response item is the answer. Bound output size and reject empty or malformed responses. Do not send network requests in this task.

**Verify:** Unit tests cover all four request bodies, destinations, auth metadata, representative responses, invalid model IDs, and absence of API keys from body/preview data. Run `cargo test --lib` and `git diff --check`.

## Task 4: Prepared review and one-time send

**Files:** Create a backend review module; modify `src-tauri/src/core/mod.rs`, `src-tauri/src/lib.rs`, and query execution error capture; add focused Rust tests.

Make Rust select bounded schema metadata and build Generate, Explain, or Fix context. Fix must use the last executed failed statement recorded in memory, not current editor text. Preparation returns provider, destination, exact body preview, local-only metadata, and a short-lived opaque token. Keep bytes server-side. Sending consumes the token before HTTP, rechecks connection identity and AI policy, resolves only the selected provider key, and transmits the exact prepared bytes. Do not retry on timeout, fall back to another provider, include rows, persist prompts/responses, or run SQL. Replacing the old `text_to_sql` command must precede exposing new UI; at minimum disable it until the reviewed path replaces it.

**Verify:** Tests cover byte parity, expiry, single use, wrong connection, policy revocation, connection switch, key not in preview, response bounds, and no alternate-provider fallback. Run Rust and frontend suites and build.

## Next Plan

In-app key setup and provider test, then the resizable Generate/Explain/Fix assistant panel with payload review and stale-editor-safe Copy/Insert/Apply.
