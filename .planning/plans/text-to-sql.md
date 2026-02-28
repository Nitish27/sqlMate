# Plan: Text-to-SQL (AI-Powered Query Generation)

## Overview

Add an AI ✨ button to the SQL editor toolbar that opens a popover for natural language → SQL conversion using Gemini API. The backend (Rust/Tauri) calls Gemini with full database schema context for accurate SQL generation.

**Problem:** Writing SQL manually requires knowledge of table/column names and syntax.  
**Who benefits:** All SqlMate users, especially those less comfortable with SQL.  
**Acceptance Criteria:**
- AI button visible after BEAUTIFY in SQL editor toolbar
- Clicking opens a popover with text input
- Natural language input is converted to valid SQL via Gemini API
- Generated SQL replaces editor content
- Schema context (table/column names & types) sent for accuracy
- Loading and error states handled inline

## Architecture Decisions

### 1. API Call Location → Tauri Command (Rust Backend)
- **Options:** Frontend JS SDK / Rust backend HTTP / Tauri command wrapper
- **Chosen:** Tauri command — API key stays in Rust, clean `invoke()` pattern
- **Rationale:** Consistent with all other data operations in the app

### 2. API Key Storage → `.env` File
- **Options:** Settings modal / `.env` file / In-memory prompt
- **Chosen:** `.env` file (already exists with `YOUR_GEMINI_API_KEY`)
- **Rationale:** User already has `.env` configured, zero additional UI needed

### 3. Schema Context → Full (Tables + Columns + Types)
- **Chosen:** Fetch all tables → fetch structure for each → send as context
- **Rationale:** Required for queries like "Users who never ordered" which need join/column knowledge

### 4. UI Pattern → Popover anchored to AI button
- **Chosen:** Matching existing `ColumnVisibilityPopover` pattern
- **Rationale:** Compact, non-intrusive, consistent with codebase style

---

## Tasks

### Task 1: Add `reqwest` and `dotenvy` to Cargo.toml
- **Files:** `src-tauri/Cargo.toml`
- **Changes:** Add `reqwest = { version = "0.12", features = ["json"] }` and `dotenvy = "0.15"`
- **Dependencies:** None
- **Verification:** `cargo check` passes
- **Effort:** S | **Risk:** Low

### Task 2: Create `ai_service.rs` module
- **Files:** `src-tauri/src/core/ai_service.rs`, `src-tauri/src/core/mod.rs`
- **Changes:**
  - New file with `generate_sql(api_key, prompt, schema_context, db_type) -> Result<String>`
  - Calls Gemini REST API: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
  - System prompt instructs: "You are a SQL expert. Given the database schema below, generate ONLY the SQL query. No markdown, no explanation."
  - Parse response JSON → extract `candidates[0].content.parts[0].text`
  - Add `pub mod ai_service;` to `mod.rs`
- **Dependencies:** Task 1
- **Verification:** Module compiles, unit test with mock if feasible
- **Effort:** M | **Risk:** Med (API format changes)

### Task 3: Create `text_to_sql` Tauri command
- **Files:** `src-tauri/src/lib.rs`
- **Changes:**
  - New `#[tauri::command] async fn text_to_sql(state, connection_id, prompt) -> Result<String, String>`
  - Steps: read API key from env → fetch sidebar items (tables) → fetch structure per table → build schema string → call `ai_service::generate_sql()` → return SQL
  - Add `dotenvy::dotenv().ok()` in `run()` function
  - Register `text_to_sql` in `generate_handler!`
- **Dependencies:** Task 2
- **Verification:** `cargo build` passes, command callable from frontend
- **Effort:** M | **Risk:** Low

### Task 4: Create `AiTextToSql.tsx` popover component
- **Files:** `src/components/AiTextToSql.tsx`
- **Changes:**
  - Sparkles icon button (matches BEAUTIFY style)
  - Popover panel: text input + submit button
  - States: idle → loading (spinner) → success (auto-close) / error (red msg)
  - Calls `invoke('text_to_sql', { connectionId, prompt })`
  - Props: `connectionId: string`, `onSqlGenerated: (sql: string) => void`
  - Click-outside-to-close behavior
- **Dependencies:** Task 3
- **Verification:** Component renders, popover opens/closes
- **Effort:** M | **Risk:** Low

### Task 5: Integrate AI button into `TabContentQuery.tsx`
- **Files:** `src/components/TabContentQuery.tsx`
- **Changes:**
  - Import `AiTextToSql`
  - Render after BEAUTIFY button (line ~194)
  - Pass `connectionId` and `onSqlGenerated={handleQueryChange}`
- **Dependencies:** Task 4
- **Verification:** Button visible in toolbar, full end-to-end flow works
- **Effort:** S | **Risk:** Low

### Task 6: End-to-end testing & polish
- **Files:** All modified files
- **Changes:** Test all example queries, handle edge cases (empty input, API errors, no tables connected)
- **Dependencies:** Task 5
- **Verification:** All 4 example queries produce valid SQL
- **Effort:** S | **Risk:** Low

---

## Execution Waves

### Wave 1 — Backend Foundation (Tasks 1-2)
- Add dependencies, create AI service module
- **Parallel:** Both can be done in one pass

### Wave 2 — Backend Integration (Task 3)
- Wire up the Tauri command with schema context

### Wave 3 — Frontend (Tasks 4-5)
- Build popover component and integrate into toolbar
- **Parallel:** Component creation + integration are sequential

### Wave 4 — Verification (Task 6)
- End-to-end testing with all example queries

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Gemini API response format changes | Low | High | Pin to `v1beta`, validate response shape |
| 2 | Schema fetch slow for DBs with many tables | Med | Med | Limit to first 50 tables, add timeout |
| 3 | Generated SQL has syntax errors | Med | Low | User reviews before running; this is expected |
| 4 | API key missing/invalid | Med | Med | Clear error message in popover |
| 5 | `reqwest` conflicts with existing deps | Low | High | It's already in the dep tree transitively |

**Assumptions:**
- User has a valid Gemini API key in `.env`
- Internet connectivity available for API calls
- Database is connected before using the AI feature

**Out of scope:**
- Chat/conversation history with Gemini
- SQL explanation/correction features
- API key management UI
- Streaming/typewriter effect for SQL output

---

## Verification Checklist

- [ ] `cargo check` passes after dependency changes
- [ ] `cargo build` passes with new Tauri command
- [ ] AI ✨ button appears after BEAUTIFY in toolbar
- [ ] Popover opens on click, closes on outside click
- [ ] "Show all users" → generates valid `SELECT` query
- [ ] "Top 5 products by sales" → generates `ORDER BY ... LIMIT 5`
- [ ] "Users who never ordered" → generates `LEFT JOIN` or `NOT IN`
- [ ] "Revenue this month" → generates date-filtered aggregation
- [ ] Empty input shows validation (no API call)
- [ ] Invalid API key shows error in popover
- [ ] Loading spinner shows during API call

## Success Criteria

✅ User types natural language, gets valid SQL in the editor  
✅ Works with the connected database's actual schema  
✅ No API key exposure in frontend  
✅ Clean UX matching existing app design patterns
