# Assistant-First AI Design

Date: 2026-10-15
Status: Approved design; implementation not started

## Goal

Make AI useful inside SqlMate without making database access or data disclosure surprising. A user supplies their own developer API key, asks for help in the SQL workspace, reviews the exact outbound content, and decides whether to use the answer. AI never executes SQL.

## Decisions and Alternatives

- Ship an in-app assistant before MCP or autonomous agents. It covers the immediate Generate, Explain, and Fix workflows with a smaller security surface.
- Support Gemini, Groq, Anthropic Claude, and OpenAI API models. Consumer ChatGPT or Claude subscriptions are not authentication for these APIs; users supply developer API keys and may incur separate API charges.
- Make direct provider requests from the Tauri/Rust backend. A renderer-side request would expose long-lived keys to the webview; a SqlMate proxy would require hosted infrastructure, billing, and custody of user prompts. Neither is justified for this BYOK release.
- Keep existing environment-file setup for advanced users, but make OS-keychain-backed in-app setup the primary path. Never bundle a shared provider key.
- Require production-tagged connections to opt in explicitly to AI. Ordinary connections may use AI after a provider is configured, but no data leaves the app until the user invokes an action and reviews the payload.

## User Journey

1. In Settings > AI, choose a provider, paste a developer API key, test it, and optionally choose the default provider and model. Cards show availability and a masked key state, never the saved key. An externally configured `.env` key is shown as externally managed, not displayed or overwritten.
2. Open the SQL workspace's resizable assistant side panel. Choose Generate, Explain, or Fix, and select a configured provider. Generate starts from a natural-language request; Explain uses the active SQL statement; Fix uses the most recent *executed failed statement* and its database error, not whatever text is currently under the caret.
3. Review the provider destination and exact request body, including model, system instructions, user request, selected schema metadata, SQL, and error text that will leave the machine. The authentication header is identified as a stored key but its value is not displayed. No result rows or stored credentials are included in the body. The user may remove or edit contextual content, then prepares a fresh review.
4. Click a distinct **Send to provider** action. Display the answer as a proposal with Copy, Insert, or Apply. Insert/Apply requires a fresh editor-context check and never runs the SQL. A changed editor or query target makes the proposal stale; Copy and insertion into a new query tab remain available.
5. On a production-tagged connection without AI permission, explain why AI is unavailable and link to that connection's explicit opt-in. Changing a connection's tag to production revokes any prior AI permission until reapproved.

## Architecture and Data Flow

The React panel owns only transient input and display state. Tauri commands own provider configuration, connection policy, schema selection, prompt construction, provider HTTP, and audit-safe errors. Provider adapters normalize Generate/Explain/Fix requests and responses while preserving each provider's authentication and wire format. A configurable model ID avoids depending on a single hard-coded model name; defaults are maintained centrally and validated by the provider test, not assumed available forever.

`User action -> Rust context selection -> prepared exact request -> review UI -> short-lived Send token -> Rust policy/identity recheck -> provider -> proposal -> user-controlled editor change`

Preparation returns the destination and **exact outbound request body preview**, plus a short-lived, single-use token bound to the connection ID, action, provider/model, body bytes, and editor-context snapshot. Rust stores the prepared body in memory only. Send accepts the token, not a reconstructed prompt; it verifies expiry, connection identity, active target, and the current AI policy before sending exactly those body bytes. Authentication is added from the secure store at Send and never exposed in the preview. Any edit to review content, provider/model change, connection switch, or schema refresh invalidates the token and requires preparation again. Preview must distinguish local display metadata from actual provider request fields. The editor checks its current document version when applying a proposal; Rust cannot infer unsynced keystrokes. No prompt or response body is written to persistent logs or telemetry.

The existing schema cache can be reused for selection, but a prompt should include only relevant table and column metadata within a visible size budget. Schema names and comments can themselves be sensitive. The review must expose them in full before Send; the user can remove context and regenerate the review. Result rows are excluded by default and there is no row-sharing toggle in this release. An executed SQL statement and its error may contain literals or other sensitive text, so Explain and Fix receive the same exact-payload review as Generate.

## Configuration and Compatibility

Add a backward-compatible optional per-connection AI permission field to `ConnectionConfig`. For a missing field, compute the effective default from the environment: disabled for production, enabled for known non-production tags. Treat missing or unrecognized environment values conservatively until classified. Persist explicit overrides with the connection, but enforce effective policy again in the Rust prepare and send commands; UI disabling alone is not a safety boundary. Connection Safe Mode and the existing backend SQL execution policy remain authoritative when a user later runs resulting SQL.

Store each in-app provider API key under a distinct OS-keychain service/account. The key is transiently present in the key-entry form while being typed, then passed once to Rust and cleared; it is never returned by status commands or persisted in the renderer. If keychain storage is unavailable, show a recoverable error rather than silently writing plaintext. Existing `.env` keys continue to work, with documented precedence: an explicit in-app key for that provider wins; otherwise use its environment key. `SQLMATE_AI_PROVIDER` remains an external default only when no in-app default was set. A legacy plaintext Groq key in `config.json` is migrated only after a verified keychain save, then removed atomically; failure leaves the legacy entry untouched and warns the user to complete migration. Never echo keys in errors.

No database migration is expected if connection settings are serialized with serde defaults. Existing saved connections retain their non-production behavior; production connections start with AI disabled, including those saved before this feature. The current `text_to_sql` command must not remain as a bypass around review and policy: remove it or route it through the same preparation and send gate before exposing the new UI.

## Command Contracts

- Provider management: list provider/status metadata, save/delete a key, test credentials, select default provider/model. Status returns only source and availability, never key contents.
- Connection policy: read/update AI permission for a saved connection. The backend checks the connection's current environment and revokes permission on transition to production.
- Assistant: `prepare_ai_request` accepts connection ID, action, requested context identity, user instruction, and context edits; returns an exact payload preview plus opaque expiry-bound token. `send_ai_request` accepts only that token and returns a normalized proposal or typed failure.
- Fix context: the query runner records the executed failed statement and database error as an in-memory, connection-scoped context ID. The renderer cannot accidentally substitute current editor text. Clear or invalidate it on connection close or target change.

Every command validates input length and current connection identity. Network requests have timeouts and bounded response sizes. Retry of a timed-out Send creates a fresh review; it cannot reuse a consumed token. Provider tests use a minimal request and disclose that it may incur a small charge.

## Errors and Recovery

Missing key, unavailable keychain, failed provider test, invalid model, expired review, connection switch, revoked production permission, authentication failure, rate limit, timeout, and malformed response each get distinct actionable messages. Do not automatically fall back to a different provider, since that would change the recipient after review. A failed Send leaves the reviewed request and user instruction visible for retry through a fresh review. Provider output is untrusted text: strip presentation fences for SQL proposals, but do not claim SQL is safe or correct. Preserve the user's editor contents when AI fails or returns an empty answer.

## Verification and Acceptance

- Unit-test provider selection, request serialization and response parsing for all four adapters with mocked HTTP and no live keys.
- Test keychain save/read/delete and legacy migration with a mock secure store; verify plaintext is not removed before successful storage and that errors never expose keys.
- Test that production is denied at prepare **and** send, including an environment change between the two. Ordinary connections require an explicit AI action and Send.
- Test byte-for-byte parity between previewed and transmitted request body, token expiry/single-use, edits that invalidate preview, connection switches, and no provider fallback. Verify authentication header values never reach the renderer.
- Test that Generate, Explain, and Fix omit rows and credentials; Fix uses the failed executed statement even when editor text has since changed.
- Test SQL proposal Copy/Insert/Apply, stale-editor handling, no automatic execution, and Safe Mode enforcement after insertion.
- Exercise keyboard navigation, focus return, screen-reader labels, a narrow window, empty/error/loading states, and cancellation. Run an opt-in usability smoke test with fake data and fake API keys before release.

## Risks and Unknowns

- Provider models, limits, and error formats change. Keep adapters isolated, test against official APIs before release, and make model IDs user-configurable with safe defaults.
- Provider requests may reveal schema names, SQL literals, or errors even without rows. Exact review and production opt-in mitigate disclosure but cannot remove it after Send; make this explicit in the UI.
- OS keychain behavior varies by platform and packaging. Test signed macOS plus Windows/Linux builds; do not weaken storage on failure.
- Legacy `config.json` may have been backed up or synced. Migration cannot erase external copies; the UI should recommend rotating a legacy key.
- App-level environment variables in packaged builds can be confusing. In-app setup should be the documented default, while `.env` remains an advanced path.

## Scope Boundaries

This release includes BYOK setup for four providers, production opt-in, reviewed Generate/Explain/Fix requests, and user-controlled proposals. It excludes MCP, autonomous database access, automatic query execution, row sharing, Optimize, hosted credentials or billing, and consumer-app OAuth/sign-in.
