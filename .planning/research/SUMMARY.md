# Project Research Summary

**Project:** sqlMate v1.0
**Domain:** Desktop database management GUI (Tauri 2.x + React + Rust)
**Researched:** 2026-03-02
**Confidence:** MEDIUM-HIGH

---

## Executive Summary

sqlMate is targeting full TablePlus feature parity — a well-understood domain with strong reference implementations (TablePlus, DBeaver, Beekeeper Studio, DataGrip). The research is clear that reaching TablePlus parity is not primarily about adding new databases (though that matters); it is first about completing core editor and data management capabilities that users expect from any serious database tool. SQL autocomplete with schema awareness, a GUI structure editor with a pending-changes safety model, tab management polish, themes, and a preferences system are the non-negotiable table stakes. Without these, the product reads as alpha regardless of database breadth.

The recommended approach is to fix foundational architectural problems before building new features. Three structural issues currently exist that will block scaling: (1) the `ConnectionManager` has a per-database-type `HashMap` that cannot support 14+ engines without rewriting every command handler, (2) the monolithic Zustand store with 40+ fields will cause cross-tab re-render cascades as feature count grows, and (3) `localStorage` is an unreliable persistence layer in Tauri that will silently wipe user data on app upgrades. These are refactors, not new features, and they must precede any significant feature work. There is also an active security vulnerability in the current sqlx 0.7 dependency (RUSTSEC-2024-0363) that must be resolved before shipping.

The key risk is scope explosion from the 14-engine target. Each new database engine multiplies the testing matrix, introduces dialect-specific DDL quirks, and requires custom schema introspection queries. The research consensus is clear: build the `DatabaseDriver` trait abstraction first, land the three core engines (PostgreSQL, MySQL, SQLite) at full feature depth, and add additional engines one at a time with an explicit per-engine feature matrix. Attempting to ship all 14 engines with full feature parity simultaneously is a DBeaver-scale effort that took years with a full-time team.

---

## Key Findings

### Recommended Stack

The existing stack (Tauri 2.x, React 19, TypeScript 5.8, Zustand 5, Monaco 0.55, TanStack Table 8, Tailwind 3.4, sqlx 0.7, Radix UI 2) is well-chosen and requires no replacement — only additions. The primary new additions needed are: `monaco-sql-languages` for dialect-aware SQL completion (DTStack, actively maintained, used in Alibaba Cloud production), `cmdk` for the command palette (powers Linear and Raycast), `recharts` for the metrics dashboard (SVG-based, ~200KB, idiomatic JSX), and `react-hotkeys-hook` for scoped keyboard shortcuts. All frontend additions are additive and do not require existing code changes.

On the Rust side, sqlx must be upgraded from 0.7 to 0.8.x before adding new engines due to the active security advisory. New engine drivers are all available as first-class Rust crates: `tiberius` for MSSQL (Prisma-maintained), official `mongodb` v3 driver, official `clickhouse` v0.13 client, official `duckdb` v1 bindings, `cdrs-tokio` for Cassandra, `libsql` for Turso, and `fred` v9 for Redis. MariaDB, CockroachDB, and Redshift are wire-compatible with existing sqlx drivers and require only configuration changes. Oracle and Vertica have distribution complexity (require user-installed native libraries) and should be last-priority or explicitly deferred.

**Core technology additions:**
- `tiberius 0.12` (+ `bb8-tiberius`): MSSQL — Prisma-maintained, HIGH confidence
- `mongodb 3` (official): MongoDB — official driver, tokio-only since v3, HIGH confidence
- `clickhouse 0.13` (official): ClickHouse — HTTP transport, lz4 compression, HIGH confidence
- `duckdb 1` (+ `async-duckdb`): DuckDB — bundled feature, no install needed, HIGH confidence
- `libsql 0.6`: Turso/libSQL — official Turso SDK, remote feature, HIGH confidence
- `cdrs-tokio 8`: Cassandra/ScyllaDB — pure Rust, no C dependency, MEDIUM confidence
- `fred 9`: Redis — connection pooling + cluster/sentinel built in, MEDIUM confidence
- `snowflake-api 0.9`: Snowflake — community crate, undocumented API, LOW confidence
- `gcp-bigquery-client 0.24`: BigQuery — community crate, functional, MEDIUM confidence
- `tauri-plugin-store 2`: Persistent settings — replaces localStorage immediately
- `tauri-plugin-shell 2`: Backup/restore via pg_dump/mysqldump sidecars
- `tauri-plugin-window-state 2`: Window position persistence across restarts
- `monaco-sql-languages`: SQL autocomplete with dialect awareness
- `recharts`: Metrics dashboard charts (SVG, ~200KB)
- `cmdk`: Command palette with fuzzy matching and keyboard navigation
- `react-hotkeys-hook`: Scoped keyboard shortcuts per panel context
- `@tanstack/react-query`: Server-state caching for table rows and schema data

### Expected Features

All 4 researchers converge on the same tier ordering. The division is unambiguous.

**Must have (table stakes) — missing = product feels alpha:**
- SQL autocomplete with schema awareness (tables, columns, keywords, per connection) — every competing tool has this
- Table structure editor (CREATE TABLE, ALTER TABLE via GUI) with pending-changes model — read-only is insufficient
- Open Anything / Command Palette (`Cmd+P`) with fuzzy search across DB objects — TablePlus and Beekeeper both have it
- Full keyboard shortcut coverage with configurable bindings — power user expectation
- Light/Dark/System theme switching — dark-only is a 2022 product, not 2025
- Preferences window (`Cmd+,`) covering fonts, behavior, autocomplete, safe mode, CSV defaults
- Click-to-sort column headers (server-side ORDER BY, not client-sort) — universal UX
- Quick Look popup for JSON/BLOB cells — TablePlus signature feature, low implementation cost
- Console log panel showing all executed queries including internal meta-queries
- Tab rename, pin, and close-others operations — all tools implement these

**Should have (competitive differentiators):**
- Foreign key navigation (click FK cell → jump to referenced row with filter applied)
- Backup/Restore UI wrapping pg_dump/mysqldump as Tauri sidecars
- User and privilege management (MySQL first, PostgreSQL role model second)
- Safe mode system (5 levels: silent, alert-all, alert-non-select, password-all, password-non-select)
- Import UI improvements: column mapping preview, streaming large files, append/truncate/upsert mode
- Export additional formats (XLSX, HTML table, Markdown table) beyond CSV/JSON/SQL
- Connection management enhancements: groups/folders, URL import, export/import connection list
- Metrics dashboard with SQL-backed widgets (bar, line, table, input filter) and configurable refresh
- Session restore (reopen last open tabs on app launch) — community-requested but unconfirmed in TablePlus

**Defer to v2+:**
- Visual ERD diagram (Beekeeper Studio has it, TablePlus does not — out of scope for parity)
- Cross-database migration wizard (DBeaver specialty)
- Plugin system
- Multi-engine SQL autocomplete for all 14 engines simultaneously (build per engine as engines ship)
- Biometric safe mode (TouchID/Windows Hello) — nice to have, not a launch blocker

### Architecture Approach

The recommended architecture moves from the current per-engine-typed `ConnectionManager` to a `DriverRegistry` with an enum-based driver dispatch pattern. `sqlx`'s `Database` trait is explicitly not dyn-compatible, so `Box<dyn Database>` is not viable. Instead, a `DatabaseDriver` trait covers all lifecycle and schema operations, with a `DriverConnection` enum wrapping each concrete driver. `enum_dispatch` delivers up to 10x faster dispatch than vtable calls with zero overhead for the known-at-compile-time engine set. On the frontend, Zustand is split from one monolithic 40+-field store into 6 domain stores: `connectionStore`, `workspaceStore`, `schemaStore`, `historyStore`, `settingsStore`, and `uiStore` (plus a `metricsStore` for dashboard data). A singleton `LanguageServiceManager` manages Monaco completion providers — one global registration that reads from a connection-keyed schema cache, avoiding the known Monaco multi-instance completion bleed problem.

**Major components:**
1. `DriverRegistry` (Rust) — replaces `ConnectionManager`; holds all active connections, dispatches via `DriverConnection` enum; single point of change when adding a new engine
2. `DatabaseDriver` trait (Rust) — per-engine implementation contract covering connect, disconnect, schema introspection, query execution, DDL generation, metrics collection
3. `LanguageServiceManager` (TypeScript) — singleton registered once at app startup; schemaCache Map keyed by connectionId; actively active connection determines which schema is returned in completion callbacks
4. Domain-split Zustand stores (TypeScript) — 6 independent stores; row data NOT stored in Zustand (lives in a Map outside the store or component-local ref to prevent heap inflation)
5. `BackupService` (Rust) — spawns pg_dump/mysqldump via `tauri-plugin-shell` with `.spawn()` streaming, emits progress events; never buffers entire dump in memory
6. `SettingsService` (TypeScript) — typed wrapper over `tauri-plugin-store`; reads/writes to settings.json, connections.json, history.json, shortcuts.json separately

### Critical Pitfalls

All 4 research files identify the same problems from different angles. These are not independent discoveries — they are the same core risks observed through 4 lenses.

1. **sqlx 0.7 active security vulnerability (RUSTSEC-2024-0363)** — A working exploit for PostgreSQL RCE via binary protocol integer overflow is publicly known. Upgrade to sqlx 0.8.1+ before any other work. This is not optional. Add `cargo audit` to CI to catch future advisories. (PITFALLS.md Pitfall 1; STACK.md notes sqlx 0.8.x upgrade path)

2. **localStorage persistence will silently wipe user connections** — Tauri's WebView URL scheme change (already happened once between Tauri 1.x and 2.x: `https://tauri.localhost` to `http://tauri.localhost`) treats saved localStorage as a different origin. All saved connections disappear. Migrate to `tauri-plugin-store` in the first development phase, before any users accumulate data in the current production app. Include a one-time migration that reads from localStorage and writes to the new store. (PITFALLS.md Pitfall 2; ARCHITECTURE.md Settings section; STACK.md Tauri plugins section)

3. **ConnectionManager cannot scale to 14+ engines without a rewrite** — The current triple-HashMap pattern requires modifying every command handler for each new engine. This rewrite becomes exponentially more painful the more features are built on top of it. The `DriverRegistry` + `DatabaseDriver` trait refactor must happen in Phase 1 before any new engines are added. (ARCHITECTURE.md Section 1; PITFALLS.md Pitfall 7)

4. **Monaco completion providers are global, not instance-scoped** — This is a confirmed Monaco bug open since 2017. Multi-tab scenarios with different connections will bleed schema completions from one tab into another. The fix is a single globally registered provider that reads from a connection-keyed Map at call time. Registering one provider per tab is wrong and causes duplicate suggestions. (PITFALLS.md Pitfall 5; ARCHITECTURE.md Section 2; STACK.md Monaco section)

5. **Feature matrix explosion across 14 engines** — Each engine has different DDL dialect, introspection queries, user management model, and connection string format. Supporting all 14 at full feature depth simultaneously is a DBeaver-scale multi-year effort. The mitigation is: (a) build the `DatabaseDriver` trait abstraction first as a clean boundary, (b) ship PostgreSQL/MySQL/SQLite at full feature depth before adding engines, (c) for each new engine, document explicitly what subset of features is supported, and (d) for non-relational engines (Redis, MongoDB), ship read-only browsing before write/edit operations. (PITFALLS.md Pitfall 7; STACK.md driver strategy)

6. **Backup/restore depends on external binaries with version mismatch risk** — pg_dump must match the server major version. On Windows with multiple PostgreSQL installs (pgAdmin, full server, extensions), the wrong binary is silently selected. The fix: detect server version and local binary version at connection time; warn if mismatched; allow explicit binary path configuration; ship bundled binaries as Tauri sidecars for the three core engines. (PITFALLS.md Pitfall 8; ARCHITECTURE.md Backup section; STACK.md Backup section)

---

## Cross-Cutting Themes Across All 4 Research Files

These themes appear in multiple research files and represent the highest-signal synthesis findings:

**Theme 1: The pending-changes model is non-negotiable.**
FEATURES.md identifies it as "the single most important UX pattern" for structure editing and data editing. ARCHITECTURE.md dedicates a full section to it (Table Structure Editor Architecture with `PendingStructureChange`). PITFALLS.md indirectly validates it as an anti-feature protection (auto-execute on GUI click = data loss risk). The implementation: all destructive GUI actions accumulate as a local diff, generate dialect-correct DDL in Rust (not TypeScript), show a preview modal, and require explicit commit (`Cmd+S`) or discard (`Cmd+Shift+Delete`).

**Theme 2: Schema caching is the critical shared infrastructure.**
SQL autocomplete (STACK.md, ARCHITECTURE.md), the command palette (ARCHITECTURE.md), the structure editor (ARCHITECTURE.md), and the sidebar (FEATURES.md) all depend on a fast, per-connection schema snapshot. PITFALLS.md Pitfall 10 warns about stale cache invalidation. This is not a feature — it is foundational infrastructure that must be built once and used everywhere. The `schemaStore` (Zustand) + `get_schema_snapshot` Tauri command + `LanguageServiceManager` schemaCache form a shared layer that all features read from.

**Theme 3: DDL generation belongs in Rust, not TypeScript.**
ARCHITECTURE.md is explicit about this as Anti-Pattern 6. FEATURES.md notes that each engine has different ALTER TABLE syntax, quoting rules, and constraint naming. PITFALLS.md Pitfall 14 demonstrates the existing wrapping helpers already break on CTEs and engine-specific edge cases. STACK.md's driver strategy reinforces per-engine implementation. The rule: TypeScript renders a diff for the user to review; Rust generates the actual SQL; the user confirms.

**Theme 4: Store refactoring and persistence migration are prerequisites, not features.**
ARCHITECTURE.md, PITFALLS.md (Pitfalls 2 and 9), and STACK.md all converge on the same diagnosis: the monolithic Zustand store and localStorage persistence are technical debt that will block all future feature work. Both must be addressed in Phase 1 before any new features are added. These are invisible to the user but prevent the features from being buildable at scale.

**Theme 5: Recharts is the right chart library, but requires server-side data decimation.**
STACK.md recommends Recharts. ARCHITECTURE.md uses Recharts in all code examples. However, PITFALLS.md Pitfall 11 is a critical caveat: SVG charts degrade severely past 5,000 data points. The resolution agreed across files: pre-aggregate/decimate chart data in Rust before sending to the frontend via the metrics poller hook, enforce a hard 2,000 data point limit per chart widget, and inform the user when data was downsampled.

**Agreements Across All 4 Files:**
- `cmdk` for the command palette (ARCHITECTURE.md names it explicitly; FEATURES.md describes the exact UX; STACK.md doesn't conflict)
- `tauri-plugin-store` to replace localStorage (STACK.md, ARCHITECTURE.md, PITFALLS.md all require it)
- `monaco-sql-languages` as the autocomplete foundation (STACK.md and ARCHITECTURE.md both recommend it; PITFALLS.md identifies the global-provider problem it solves)
- Backup via sidecar pg_dump (STACK.md, ARCHITECTURE.md, FEATURES.md, PITFALLS.md all align on this approach)
- Enum-based driver dispatch as the multi-engine pattern (ARCHITECTURE.md defines it; PITFALLS.md validates the problem it solves; STACK.md provides the driver crates)

**Contradictions and Tensions:**
- Recharts vs. canvas-based charts: STACK.md recommends Recharts (HIGH confidence); PITFALLS.md warns it collapses at >5K points (HIGH confidence). Resolution: use Recharts with mandatory server-side decimation. Do not switch to ECharts unless user queries routinely return raw time-series beyond 5K rows.
- Snowflake and Vertica support: STACK.md assigns LOW confidence to both drivers (community crate for Snowflake, ODBC bridge for Vertica). PITFALLS.md Pitfall 7 warns about feature matrix explosion. Resolution: defer both to v1.1 or post-launch. Include them in the driver trait but do not ship them in v1.0.
- Session restore: FEATURES.md notes TablePlus does NOT have confirmed session restore (LOW confidence). ARCHITECTURE.md's `workspaceStore` is described as "session-only by default." Resolution: do not implement session restore in v1.0. It is a nice-to-have that may not even exist in the target product.

---

## Implications for Roadmap

Based on combined research across all 4 files, the recommended phase structure is:

### Phase 0: Security and Foundation Repair (Non-Negotiable Prerequisite)
**Rationale:** Two critical blockers exist that make all subsequent work either dangerous or impossible. This phase has no user-visible features but unblocks everything else. Must be done before any other work.
**Delivers:** Secure, stable foundation; no data loss risk; scalable architecture
**Key work:**
- Upgrade sqlx to 0.8.1+ (RUSTSEC-2024-0363 security patch; MSRV bumps to Rust 1.78)
- Migrate persistence from localStorage to `tauri-plugin-store` with a one-time migration for existing users
- Refactor `ConnectionManager` into `DriverRegistry` with `DatabaseDriver` trait and `DriverConnection` enum dispatch
- Split monolithic Zustand store into 6 domain stores (`connectionStore`, `workspaceStore`, `schemaStore`, `historyStore`, `settingsStore`, `uiStore`)
- Fix `test_connection` to use options builder pattern instead of password-in-URL string interpolation (Pitfall 15)
**Avoids:** RUSTSEC-2024-0363 RCE exposure; localStorage data loss on upgrade; ConnectionManager rewrite debt; Zustand performance collapse
**Research flag:** Standard patterns. No additional research needed.

### Phase 1: Core Editor Completeness (Table Stakes Features)
**Rationale:** FEATURES.md identifies these as "without these, the tool feels alpha." ARCHITECTURE.md's schema cache infrastructure is the shared dependency for autocomplete, structure editor, and command palette. All three features draw from the same schema snapshot — build the infrastructure once here.
**Delivers:** A product that a developer would use daily instead of TablePlus for their primary workflow
**Key work:**
- Schema introspection infrastructure: `get_schema_snapshot` Tauri command, `schemaStore`, auto-invalidation after DDL execution
- SQL autocomplete: `LanguageServiceManager` singleton, `monaco-sql-languages` integration, per-connection schema cache, dialect mapping (PostgreSQL/MySQL/SQLite/generic)
- Table structure editor: `PendingStructureChange` model, per-driver DDL generation in Rust, preview modal, inline column/index/FK editing
- Command palette (`Cmd+P`): `cmdk` integration, fuzzy search across tables/views/functions/saved queries/connections/actions
- Keyboard shortcuts: `react-hotkeys-hook` with scoped contexts (editor, table-grid, tab-bar), configurable bindings
- Theme system: Tailwind `darkMode: 'class'` toggle, Light/Dark/System support, persisted via `settingsStore`
- Preferences window (`Cmd+,`): fonts, autocomplete toggles, default behaviors, safe mode level selection
**Uses:** `monaco-sql-languages`, `cmdk`, `react-hotkeys-hook`, `tauri-plugin-store`, `DriverRegistry` from Phase 0
**Implements:** `LanguageServiceManager`, `schemaStore`, `structureEditorStore`, `settingsStore`
**Avoids:** Monaco global completion provider bleed (Pitfall 5); DDL generation in TypeScript (Anti-Pattern 6); hardcoded keyboard shortcuts (FEATURES.md anti-feature)
**Research flag:** Standard patterns. Architecture file provides implementation-ready code for all components.

### Phase 2: Data Quality and UX Polish
**Rationale:** FEATURES.md Tier 2 items. These are individually low-to-medium complexity but together determine whether daily users find the tool polished or frustrating. No major architectural dependencies — these all use the infrastructure from Phases 0-1. Group them together because they share the table data view as a surface.
**Delivers:** A tool that feels complete and professional rather than functional-but-rough
**Key work:**
- Quick Look popup: JSON prettified with syntax highlighting, BLOB hex/binary view, long text expansion; triggered by right-click or middle-click
- Foreign key navigation: hover arrow on FK cells, click opens referenced table with filter applied
- Click-to-sort column headers: server-side ORDER BY (not client-sort), multi-column sort with shift-click
- Console log panel (`Cmd+Shift+C`): ring buffer in `historyStore`, per-connection filter, query status with execution time, clear button
- Tab management polish: tab rename (right-click), pin (double-click), close-others (right-click context menu), `Cmd+1-9` to jump to tab
- Import UI: column mapping preview, streaming large files without memory spike, append/truncate/upsert mode toggle
- Export additional formats: XLSX, HTML table, Markdown table rows (alongside existing CSV/JSON/SQL)
- BLOB column protection: detect binary columns during schema introspection; return `<BLOB: N KB>` placeholder by default; explicit download on cell click
- Pagination fix: detect CTEs in `wrap_pagination` to avoid invalid SQL wrapping (Pitfall 14)
**Avoids:** Loading entire files into memory (FEATURES.md anti-feature); BLOB memory spike (Pitfall 13); CTE pagination break (Pitfall 14)
**Research flag:** Standard patterns. No additional research needed.

### Phase 3: Backup, Restore, and Safety Features
**Rationale:** FEATURES.md Tier 3. These features require external binary integration (pg_dump/mysqldump) and the safe mode subsystem. Backup is a medium-complexity feature with high pitfall surface (version mismatch, path detection, Windows quoting). Group backup/restore and safe mode together because both relate to production data safety.
**Delivers:** Production-safe workflow; users comfortable using sqlMate on production databases
**Key work:**
- Backup UI: `tauri-plugin-shell` subprocess spawning with streaming events; pg_dump/mysqldump/sqlite3 as Tauri sidecars; progress indicator fed by `backup:progress` events
- Restore UI: streaming restore with progress; version mismatch detection at connection time; user-configurable binary path
- Binary version detection: detect server version and local pg_dump version; warn on mismatch; document minimum binary versions
- Safe mode system: 5 levels (silent/alert-all/alert-non-select/password-all/password-non-select); destructive query detection (UPDATE without WHERE, DELETE without WHERE, DROP, TRUNCATE, ALTER); integration with preferences
- User management: MySQL first (SELECT/INSERT/UPDATE/DELETE/CREATE/DROP privilege checkboxes); PostgreSQL role model second (role vs. user distinction, WITH GRANT OPTION, schema-level grants)
**Uses:** `tauri-plugin-shell`, bundled sidecars in `tauri.conf.json`, `PGPASSWORD` via env var (not shell interpolation)
**Avoids:** Password-in-pg_dump-args shell injection (ARCHITECTURE.md Anti-Pattern 5); missing binary silent failures (Pitfall 8)
**Research flag:** May benefit from research into bundling pg_dump/mysqldump binaries across platforms (licensing, size, version selection). The backup binary distribution approach is the least-documented aspect of the TablePlus model.

### Phase 4: Additional Database Engines
**Rationale:** Must come after the `DriverRegistry` abstraction (Phase 0) is fully in place. Engine additions are now purely additive — one new module per engine, no changes to existing command handlers. Prioritize by estimated user demand and driver confidence level.
**Delivers:** TablePlus-competitive engine breadth
**Delivery order within phase (by confidence and demand):**
1. MariaDB, CockroachDB, Redshift — wire-compatible with existing sqlx drivers; near-zero implementation cost; HIGH confidence
2. MSSQL — `tiberius` + `bb8-tiberius`; Prisma-maintained; HIGH confidence; significant user demand
3. MongoDB — official v3 driver; read-only browsing first, then query editing; HIGH confidence
4. ClickHouse — official HTTP client; schema via `system.tables`/`system.columns`; HIGH confidence
5. DuckDB — bundled feature, no user install required; async-duckdb wrapper for Tokio; HIGH confidence
6. Turso/libSQL — official Turso SDK; remote + local file; HIGH confidence
7. Redis — `fred` v9; key-value browser; non-relational (no SQL autocomplete); MEDIUM confidence
8. Cassandra/ScyllaDB — `cdrs-tokio`; CQL-compatible; read-only first; MEDIUM confidence
9. BigQuery — `gcp-bigquery-client`; GCP auth complexity; MEDIUM confidence
10. Snowflake — community crate only; undocumented API; LOW confidence — defer to v1.1
11. Oracle — requires Instant Client install; distribution complexity; MEDIUM confidence — gate behind explicit warning
12. Vertica — ODBC bridge only; requires user-installed driver; LOW confidence — defer to v1.1
**Implements:** One `DriverConnection` enum variant + one `impl DatabaseDriver` module per engine
**Avoids:** Feature matrix explosion by implementing per-engine support matrix documentation (Pitfall 7)
**Research flag:** Each individual engine implementation may warrant a focused research sprint, particularly for MSSQL (tiberius API), MongoDB (non-relational query model adaptation), and engines requiring external library distribution (Oracle).

### Phase 5: Metrics Dashboard
**Rationale:** Placed last because it is the most architecturally self-contained feature (its own store, its own poller hook, its own UI surface) and has the highest implementation complexity. It requires Recharts to be integrated, the metrics polling infrastructure, and server-side aggregation in each driver implementation. It is also the only feature that is unique to TablePlus and not universal among DB tools — making it a differentiator rather than a table-stakes requirement.
**Delivers:** Internal dashboarding capability; the highest-differentiation TablePlus feature
**Key work:**
- `metricsStore` with ring buffer (max 60 time points per metric)
- `useMetricsPoller` hook with configurable interval and silent failure
- Per-driver `get_metrics()` implementation querying system views (pg_stat_activity, performance_schema, etc.)
- Widget types: bar chart, line chart, data table, input filter field with parameterized queries
- Recharts integration with mandatory server-side decimation before data reaches the chart (Pitfall 11 mitigation)
- Widget persistence in `settings.json` or a separate `dashboards.json`
- Per-widget configurable refresh: timed (N seconds), event-triggered (input field → linked widget), manual
**Uses:** `recharts`, `metricsStore`, `useMetricsPoller`, Tauri `window.emit` for streaming
**Avoids:** SVG chart collapse at >5K data points via server-side LTTB decimation or time-bucket grouping (Pitfall 11); raw row data sent to JS for client-side aggregation (Pitfall 4)
**Research flag:** May need research into per-engine system view availability (not all 14 engines have equivalent performance views). MySQL performance_schema must be enabled explicitly. Some engines (Redis, MongoDB) have fundamentally different metrics APIs.

### Phase Ordering Rationale

- Phase 0 before everything: two show-stopper blockers (security vulnerability, data loss risk) plus the architectural prerequisite (DriverRegistry) for Phase 4. Cannot be deferred.
- Phase 1 before Phase 2: schema introspection infrastructure built in Phase 1 is consumed by Quick Look, FK navigation, and column-sort in Phase 2. Also, autocomplete and structure editor in Phase 1 are the highest-user-impact items that make the product feel complete.
- Phase 2 before Phase 3: Polish work in Phase 2 is lower risk and can be parallelized with Phase 0 work by a second team member. Phase 3 backup/restore has external binary complexity that is better tackled once the core UX is stable.
- Phase 3 before Phase 4: Safe mode and backup/restore require connection-level integration. Better to have them working on the 3 core engines before expanding to 14. User management must also be engine-aware.
- Phase 4 before Phase 5: Each new engine must implement `get_metrics()` in the driver trait. If metrics dashboard ships before engines, the dashboard will only work on PostgreSQL/MySQL/SQLite.
- Phase 5 last: self-contained, highest complexity, differentiator (not table stakes). Can be moved earlier if user demand signals make it a priority.

### Research Flags

Phases needing deeper research during planning:
- **Phase 3 (Backup/Restore):** Binary bundling strategy across Windows/macOS/Linux — licensing for shipping pg_dump/mysqldump binaries, size constraints, version selection when multiple server versions must be supported. TablePlus's actual approach here is underdocumented.
- **Phase 4 (New Engines, per-engine):** Each engine beyond Tier 1 (MariaDB/CockroachDB/Redshift) likely needs a focused research sprint before implementation. MSSQL (tiberius API surface), MongoDB (non-relational query model in a SQL-centric UI), Oracle (Instant Client distribution), BigQuery (GCP auth flows) each have significant unknowns.
- **Phase 5 (Metrics):** Per-engine system view availability and metrics API variations. MySQL performance_schema enablement requirement. Redis INFO command vs. metrics concept. Snowflake/BigQuery cloud-only metrics access patterns.

Phases with standard, well-documented patterns (skip additional research):
- **Phase 0:** All solutions are documented with implementation-ready code in ARCHITECTURE.md and PITFALLS.md.
- **Phase 1:** ARCHITECTURE.md provides complete TypeScript and Rust code for all major components. `cmdk`, `monaco-sql-languages`, and `react-hotkeys-hook` have comprehensive documentation.
- **Phase 2:** All features use established patterns (TanStack Table for grid, react-window for virtualization, existing Tauri IPC). No novel integration points.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack — core additions | HIGH | All primary additions (tiberius, mongodb, clickhouse, duckdb, libsql, cmdk, recharts, react-hotkeys-hook) are verified against official docs or crates.io |
| Stack — Snowflake and Vertica | LOW | No official Rust drivers; community crates use undocumented APIs; ODBC bridge requires user install |
| Stack — monaco-sql-languages compat | MEDIUM | Library is actively maintained, but version compat with Monaco 0.55.x (library guarantees 0.37.x) needs hands-on testing |
| Features — TablePlus parity | HIGH | Primary source is TablePlus official documentation; all Tier 1 and Tier 2 features verified directly |
| Features — session restore | LOW | Not confirmed as implemented in TablePlus; may be a missing feature in the target product itself |
| Architecture — DriverRegistry pattern | HIGH | enum_dispatch is well-documented; sqlx dyn-incompatibility is confirmed in official sqlx docs |
| Architecture — Monaco LanguageServiceManager | HIGH | Global completion provider limitation confirmed as open Monaco bug since 2017 |
| Architecture — domain-split Zustand stores | HIGH | Standard Zustand scaling pattern; confirmed in multiple production case studies |
| Pitfalls — sqlx security vulnerability | HIGH | Official RustSec advisory; working exploit publicly demonstrated |
| Pitfalls — localStorage wipe | HIGH | Confirmed Tauri GitHub issue; documented behavior change between Tauri 1.x and 2.x |
| Pitfalls — SSH tunnel thread safety | MEDIUM | Based on libssh2 documentation and code inspection; no specific sqlMate test case confirmed |
| Pitfalls — Recharts performance limit | HIGH | Confirmed by Recharts maintainers in GitHub issues with specific row count benchmarks |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Monaco 0.55 + monaco-sql-languages compatibility:** The library documents stability guarantees only on Monaco 0.37.x. sqlMate uses 0.55.x. A compatibility test with a minimal proof-of-concept should be the first task of Phase 1's autocomplete work. If incompatible, the fallback is a custom `registerCompletionItemProvider` implementation (more work, full control, no version dependency).

- **pg_dump binary bundling feasibility:** The STACK.md and ARCHITECTURE.md both assume bundling pg_dump/mysqldump as Tauri sidecars. The licensing terms for redistributing these binaries in a desktop app need legal verification. PostgreSQL is BSD-licensed (generally permissive); MySQL is GPL (may require open-sourcing or purchasing a commercial license). This may change the backup implementation strategy for MySQL.

- **Windows IPC performance threshold:** PITFALLS.md documents that Tauri IPC on Windows has measurably worse performance for large payloads (200ms+ for 10MB vs. 5ms on macOS). The current 100-row default page size may need to be lower on Windows, or the streaming query pattern must be enforced for all queries above a threshold. The exact threshold needs measurement on representative Windows hardware.

- **Schema introspection query coverage for all 14 engines:** The `DatabaseDriver` trait includes `get_schema_snapshot()` but the research does not cover the specific `information_schema` queries (or equivalent) for all 14 engines. DuckDB, ClickHouse, Redis, and MongoDB have fundamentally different schema introspection approaches. This is a per-engine implementation question, not an architecture question — but it must be researched for each engine in Phase 4.

- **Oracle Instant Client distribution strategy:** Oracle requires users to install Oracle Instant Client (a proprietary C library) before the Oracle driver can function. This is a significant friction point for a desktop app that installs cleanly otherwise. The options are: (1) gate the feature behind a setup wizard, (2) bundle Instant Client (licensing may not permit this for all scenarios), or (3) defer Oracle support to post-v1.0. This decision needs explicit product-level input before Phase 4 planning.

---

## Sources

### Primary (HIGH confidence)
- [TablePlus Official Documentation](https://docs.tableplus.com) — autocomplete, structure editor, metrics board, backup/restore, user management, safe mode, console log, preferences, tabs/workspaces, Quick Look
- [RustSec Advisory RUSTSEC-2024-0363](https://rustsec.org/advisories/RUSTSEC-2024-0363.html) — sqlx security vulnerability
- [Tauri 2.x Official Docs](https://v2.tauri.app) — store plugin, shell plugin, window-state plugin, global-shortcut plugin, dialog plugin, capabilities config
- [sqlx Official Docs](https://docs.rs/sqlx) — Database trait dyn-incompatibility, AnyPool limitations, 0.8.x migration
- [enum_dispatch crate docs](https://docs.rs/enum_dispatch) — dispatch performance benchmarks
- [Monaco Editor Issue #593](https://github.com/microsoft/monaco-editor/issues/593) — global completion provider limitation (open since 2017)
- [DTStack monaco-sql-languages](https://github.com/DTStack/monaco-sql-languages) — SQL autocomplete library
- [cmdk GitHub](https://github.com/dip/cmdk) — command palette library
- [Recharts Issue #1146](https://github.com/recharts/recharts/issues/1146) — SVG performance at large data volumes (maintainer confirmed)
- [Tauri IPC Discussion #11915](https://github.com/tauri-apps/tauri/discussions/11915) — Windows IPC performance characteristics
- [Tauri localStorage Issue #4455](https://github.com/tauri-apps/tauri/issues/4455) — WebView origin change data loss
- [mongodb Rust driver docs](https://www.mongodb.com/docs/drivers/rust/current/) — v3 tokio-only requirement
- [ClickHouse Rust client docs](https://clickhouse.com/docs/integrations/rust) — official clickhouse crate
- [DuckDB Rust client docs](https://duckdb.org/docs/stable/clients/rust) — bundled feature
- [Turso Rust quickstart](https://docs.turso.tech/sdk/rust/quickstart) — libsql crate
- [tiberius GitHub (Prisma)](https://github.com/prisma/tiberius) — MSSQL driver

### Secondary (MEDIUM confidence)
- [Beekeeper Studio Features/Import-Export](https://www.beekeeperstudio.io) — streaming import pattern, Excel export, column mapping preview
- [DBeaver SQL Assist docs](https://dbeaver.com/docs/dbeaver/SQL-Assist-and-Auto-Complete/) — introspection levels, schema refresh behavior
- [DataGrip Introspection docs](https://www.jetbrains.com/help/datagrip/introspection-levels.html) — semantic completion model
- [pgAdmin Grant Wizard docs](https://www.pgadmin.org/docs/pgadmin4/8.14/grant_wizard.html) — PostgreSQL role/privilege model
- [Aptabase blog — persistent state in Tauri](https://aptabase.com/blog/persistent-state-tauri-apps) — localStorage migration pattern
- [keyring-rs GitHub](https://github.com/hwchen/keyring-rs) — Linux headless failure behavior
- [cdrs-tokio GitHub](https://github.com/krojew/cdrs-tokio) — Cassandra pure-Rust driver
- [gcp-bigquery-client crates.io](https://crates.io/crates/gcp-bigquery-client) — BigQuery REST API client

### Tertiary (LOW confidence)
- [snowflake-api docs.rs](https://docs.rs/snowflake-api) — community Snowflake driver (undocumented API)
- [odbc-api crates.io](https://crates.io/crates/odbc-api) — ODBC bridge for Vertica (requires user-installed driver)
- [TablePlus GitHub Issue #1260](https://github.com/) — session restore community request (feature may not exist in target product)
- [libssh2 thread safety discussion](https://libssh2-devel.cool.haxx.narkive.com/uc4DbQEq/libssh2-thread-safety) — SSH tunnel race condition

---

*Research completed: 2026-03-02*
*Ready for roadmap: yes*
