# Plan: Assistant-First AI Foundations

**Goal:** Enforce connection-aware AI permission before provider calls and establish keychain-backed BYOK configuration.
**Requires:** `2026-10-15-assistant-first-ai-design.md`
**Provides:** Policy and credential boundaries for provider adapters and reviewed requests.
**Context budget:** Two tasks; stop and checkpoint after this plan before the provider/review/UI plan.

## Task 1: Connection-scoped AI permission and legacy-call gate

**Files:**
- Modify: `src-tauri/src/core/mod.rs`
- Modify: `src-tauri/src/core/connection_manager.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/store/databaseStore.ts`
- Modify: `src/components/ConnectionModal.tsx`
- Modify: `src/utils/connectionCredentials.ts`
- Create: `scripts/ai-connection-policy.test.mjs`
- Create: `src/utils/aiConnectionPolicy.ts`

**Action:**
Add optional `ai_enabled` to Rust and saved frontend connection metadata. Effective policy is false for unknown/missing environments, false for production unless explicitly enabled for that current environment, and true for known non-production environments if unset. An explicit production opt-in must be toggled in the connection form and persisted. Transitioning from non-production to production clears any prior opt-in. The Rust connection manager must expose a policy check and update live metadata for metadata-only edits; no UI-only permission gate. Call this check in existing `text_to_sql` before schema retrieval or HTTP. Keep the existing SQL execution safety policy unchanged. When reconnecting, forward saved policy to Rust. Never place API keys in connection metadata. Test environment defaults, production transition, live policy update, and that the existing provider call returns permission denied before provider-key resolution.

**Avoid:** Do not treat `safety_mode` as AI permission or silently opt production in. Do not allow a metadata-only environment edit to leave the Rust connection with a stale tag.

**Verify:** `npm test` passes, `npm run build` passes, and `cargo test --lib` in `src-tauri` passes. `git diff --check` reports no errors.

**Done when:** An existing production connection cannot call Text to SQL without an explicit opt-in; changing a connection to production revokes prior permission; saving the setting survives reconnect; test and build commands pass.

## Task 2: Secure provider-key storage and status

**Files:**
- Modify: `src-tauri/src/security/mod.rs`
- Modify: `src-tauri/src/core/ai_service.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/core/ai_credentials.rs`

**Action:**
Add a validated provider identifier and separate keychain accounts for Gemini, Groq, Anthropic, and OpenAI. Add Rust commands to save/delete keys, list masked provider status, and set a nonsecret default provider/model. Preserve `.env` key support with in-app key precedence. Resolve legacy Groq `config.json` only for migration after a verified keychain save; do not silently use or rewrite a plaintext key. Status must return source and availability only. Add a mockable secure-store boundary and tests for save/read/delete failures, precedence, malformed provider IDs, and no key leakage in errors or status.

**Avoid:** Do not return keys to the renderer, log them, store them in localStorage, or use plaintext fallback if keychain storage fails. Do not bundle a shared provider key.

**Verify:** `cargo test --lib` in `src-tauri` passes, `npm test` and `npm run build` pass, and `git diff --check` reports no errors.

**Done when:** Four providers can have separate user-owned keys; status never reveals a key; `.env` users still work; failure does not create plaintext storage; all tests and builds pass.

## Next Plan

Provider adapters and prepared exact-payload review, followed by the assistant panel and proposal actions. Do not expose new AI actions until `text_to_sql` is routed through the review gate or removed.
