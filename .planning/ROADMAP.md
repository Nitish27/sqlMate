# sqlMate v1.0 Roadmap — TablePlus Feature Parity

## Milestone: v1.0

**Goal:** Full TablePlus feature parity — transform sqlMate from a capable prototype into a production-grade database management tool.

**Total Phases:** 10
**Depth:** Comprehensive
**Parallelization:** Enabled

---

## Phase 1: Security & Foundation Repair

**Goal:** Eliminate critical security vulnerabilities, fix data persistence risks, and establish scalable architecture patterns that all subsequent phases depend on.

**Requirements:** FR-01.1, FR-01.2, FR-01.3, FR-01.4, FR-01.5, FR-01.6

**Deliverables:**
- sqlx upgraded to 0.8.1+ (RUSTSEC-2024-0363 patched)
- All localStorage usage migrated to tauri-plugin-store with one-time migration for existing users
- ConnectionManager replaced with DriverRegistry + DatabaseDriver trait + DriverConnection enum dispatch
- Monolithic Zustand store split into 6 domain stores (connectionStore, workspaceStore, schemaStore, historyStore, settingsStore, uiStore)
- test_connection using options builder pattern (no URL string interpolation)
- cargo audit added to CI

**UAT Criteria:**
- [ ] App starts without errors after sqlx upgrade
- [ ] Existing saved connections are migrated and accessible after tauri-plugin-store migration
- [ ] PostgreSQL, MySQL, SQLite connections all work through DriverRegistry
- [ ] All existing features (query execution, data editing, filtering) function through new store architecture
- [ ] No passwords visible in connection URLs or shell commands

**Plans:** 4 plans

Plans:
- [ ] 01-01-PLAN.md — sqlx 0.8 upgrade, test_connection fix, cargo audit CI
- [ ] 01-02-PLAN.md — DriverRegistry refactor (ConnectionManager replacement)
- [ ] 01-03-PLAN.md — localStorage to tauri-plugin-store migration
- [ ] 01-04-PLAN.md — Zustand store split into 6 domain stores + human verification

**Blocked by:** Nothing — this is Phase 1
**Blocks:** All subsequent phases

---

## Phase 2: Preferences System & Theme Engine

**Goal:** Build the settings infrastructure and theme system that all user-facing customization depends on.

**Requirements:** FR-21.1, FR-21.2, FR-21.3, FR-21.4, FR-09.1, FR-09.2

**Deliverables:**
- Preferences window accessible via Cmd+,
- General tab: application behavior, connection defaults, SQL editor settings, table data display settings
- Fonts & Colors tab: editor font family/size, syntax colors
- Settings persisted via tauri-plugin-store (settings.json)
- Light theme implementation
- Dark/Light/System theme switching with OS preference detection
- Tailwind darkMode: 'class' toggle architecture

**UAT Criteria:**
- [ ] Cmd+, opens preferences window
- [ ] Changes in preferences persist across app restarts
- [ ] Light theme renders correctly across all views
- [ ] System theme auto-switches when OS theme changes
- [ ] Font size changes in preferences reflected in editor immediately

**Blocked by:** Phase 1 (settingsStore, tauri-plugin-store)
**Blocks:** Phase 3 (font/color customization), Phase 4 (safe mode settings)

---

## Phase 3: Query Editor Enhancements

**Goal:** Transform the query editor from basic syntax highlighting to a professional SQL IDE with autocomplete, favorites, and customization.

**Requirements:** FR-02.1–FR-02.16, FR-20.6, FR-20.7

**Deliverables:**
- Schema introspection infrastructure: get_schema_snapshot Tauri command, schemaStore, auto-invalidation after DDL
- LanguageServiceManager singleton with connection-keyed schema cache
- monaco-sql-languages integration for dialect-aware keyword completion
- Schema-aware autocomplete (table names, column names, aliases)
- Auto-uppercase SQL keywords toggle (via preferences)
- Query favorites system with keyword binding and folders
- Run Current Statement with intelligent statement boundary detection
- Editor font/size customization (reads from settingsStore)
- Syntax color customization
- Multi-cursor editing
- Split pane (Cmd+Shift+D)
- Query parameters support ($1, :param)
- Auto-save queries
- Query editor settings panel

**UAT Criteria:**
- [ ] Typing `SELECT * FROM ` shows table name suggestions for current connection
- [ ] After typing table name, column suggestions appear for that table
- [ ] Autocomplete works correctly across different tabs with different connections (no bleed)
- [ ] Saved query favorites appear in sidebar and can be inserted via keyword
- [ ] Run Current Statement executes only the statement under cursor
- [ ] Font and color changes apply to editor in real-time

**Blocked by:** Phase 1 (schemaStore, DriverRegistry), Phase 2 (settingsStore for preferences)
**Blocks:** Phase 5 (DDL preview uses editor), Phase 10 (metrics query editing)

---

## Phase 4: Table Structure Editing (GUI)

**Goal:** Enable full GUI-driven table structure management with pending changes, DDL generation, and preview.

**Requirements:** FR-03.1–FR-03.16

**Deliverables:**
- Create Table dialog: name, columns (name, type, nullable, default, PK), indexes, foreign keys
- Alter Table: add/edit/delete columns, modify constraints, add/remove indexes — all via GUI
- PendingStructureChange model: accumulates GUI changes locally, shows generated DDL preview
- DDL generation in Rust per driver dialect (PostgreSQL, MySQL, SQLite)
- Rename table, truncate table, drop table via GUI with confirmation dialogs
- Trigger management (create/edit/delete) via GUI
- Generate CREATE TABLE DDL from existing table
- Cmd+S commits pending structure changes

**UAT Criteria:**
- [ ] Create a new table via GUI with columns, PK, indexes — verify it exists in database
- [ ] Alter an existing table (add column, change type, add index) — verify DDL preview shows correct SQL
- [ ] Pending changes can be discarded without affecting the database
- [ ] DDL generation produces correct dialect-specific SQL for PostgreSQL, MySQL, and SQLite
- [ ] Drop table shows confirmation dialog and removes table from sidebar after commit

**Blocked by:** Phase 1 (DriverRegistry for per-dialect DDL generation), Phase 3 (schema introspection)
**Blocks:** Phase 6 (new engines need DDL support)

---

## Phase 5: Database Objects & Open Anything

**Goal:** Complete GUI management for all database objects (views, functions, procedures) and add the command palette for rapid navigation.

**Requirements:** FR-04.1–FR-04.7, FR-07.1–FR-07.3, FR-20.1

**Deliverables:**
- Create/edit/delete views via GUI (SQL definition editor)
- Create/edit/delete functions via GUI
- Create/edit/delete stored procedures via GUI
- Materialized view support
- Create database with encoding & collation settings
- Rename/drop database via GUI
- Command palette (Cmd+P) via cmdk: fuzzy search across tables, views, functions, procedures, databases, schemas, saved queries
- Open result directly in new tab from command palette
- Debounced backend search with fuzzy matching

**UAT Criteria:**
- [ ] Create a view via GUI, verify it appears in sidebar and is queryable
- [ ] Cmd+P opens command palette with instant fuzzy search
- [ ] Typing a table name in command palette and pressing Enter opens it in a new tab
- [ ] All 8 object types searchable: database, schema, table, view, materialized view, function, procedure, saved query
- [ ] Create/edit/delete functions works for PostgreSQL and MySQL

**Blocked by:** Phase 1 (DriverRegistry), Phase 3 (schema introspection for search index)
**Blocks:** Nothing critical — can proceed in parallel with Phase 6

---

## Phase 6: Data Viewing, Filtering & UX Polish

**Goal:** Complete the data viewing experience with Quick Look, FK navigation, click-to-sort, console log, and enhanced filtering.

**Requirements:** FR-05.1–FR-05.10, FR-06.1–FR-06.6, FR-11.1–FR-11.4, FR-19.1–FR-19.7

**Deliverables:**
- Quick Look popup: JSON pretty-print with syntax highlighting, BLOB hex/binary view, long text expansion
- Foreign key navigation: hover arrow on FK cells, click opens referenced table with filter
- Click-to-sort column headers: server-side ORDER BY, multi-column sort with shift-click
- BLOB column protection: placeholder display, download on click
- Console log panel (Cmd+Shift+C): ring buffer, per-connection filter, execution time, clear button
- Enhanced filtering: right-click cell → quick filter, right-click column header → filter, view generated SQL
- Configurable default filter column and operator, restore last filter state
- Copy cell as JSON/HTML/Markdown/CSV with headers
- Right-click table to import/export
- Export as XLSX, HTML table, Markdown table
- Streaming import for large files
- Alternating row colors, row highlighting for modified/new rows
- Right sidebar for row editing (Space key)
- Estimated row count

**UAT Criteria:**
- [ ] Right-clicking a JSON cell and choosing Quick Look shows formatted JSON in popup
- [ ] Clicking FK arrow on a foreign key cell navigates to referenced table with filter applied
- [ ] Clicking column header sorts data (server-side ORDER BY, not client sort)
- [ ] Console log shows all queries including internal meta-queries with execution time
- [ ] Right-click on cell value → Quick Filter applies correct filter
- [ ] BLOB columns show placeholder, not raw binary

**Blocked by:** Phase 1 (historyStore for console log, schemaStore for FK detection)
**Blocks:** Nothing critical

---

## Phase 7: Tab Management & Keyboard Shortcuts

**Goal:** Complete tab/workspace management and establish full keyboard shortcut coverage with configurable bindings.

**Requirements:** FR-08.1–FR-08.6, FR-20.1–FR-20.13, FR-10.1–FR-10.6

**Deliverables:**
- Pin tabs (prevent close/overwrite), rename tabs, close other tabs / close tabs to right
- New empty tab (Cmd+T), Cmd+W close tab, Cmd+1-9 jump to tab
- Multiple workspaces per connection
- react-hotkeys-hook integration with scoped contexts (editor, table-grid, tab-bar, sidebar)
- Full keyboard shortcut coverage: Cmd+D duplicate row, Cmd+I insert, Cmd+F filter, Delete key remove row
- Configurable keyboard bindings via preferences (shortcuts.json)
- Sidebar enhancements: pin to top, recent items, toggle sections, system schemas toggle, multi-database sidebar, connection/DB names

**UAT Criteria:**
- [ ] Cmd+T opens new empty tab, Cmd+W closes current tab
- [ ] Right-click tab shows pin/rename/close-others options
- [ ] Pinned tabs cannot be accidentally closed
- [ ] All documented shortcuts work (Cmd+D, Cmd+I, Cmd+S, Cmd+F, etc.)
- [ ] Users can rebind shortcuts in preferences
- [ ] Pinned sidebar items appear at top of list

**Blocked by:** Phase 2 (preferences for shortcut config), Phase 1 (workspaceStore)
**Blocks:** Nothing critical

---

## Phase 8: Safe Mode, Backup/Restore & User Management

**Goal:** Make sqlMate safe for production database use with enhanced safe mode, backup/restore capabilities, and user/privilege management.

**Requirements:** FR-12.1–FR-12.3, FR-13.1–FR-13.4, FR-14.1–FR-14.5, FR-15.1–FR-15.7

**Deliverables:**
- 5-level safe mode: Silent, Alert-All, Alert-Non-Select, Password-All, Password-Non-Select
- Destructive query detection (UPDATE/DELETE without WHERE, DROP, TRUNCATE, ALTER)
- Password confirmation modal for safe mode levels 4-5
- Backup: pg_dump/mysqldump/sqlite3 as Tauri sidecars with streaming progress events
- Restore: streaming restore with progress, version mismatch detection
- User-configurable binary path for pg_dump/mysqldump
- Server version detection and binary version mismatch warning
- User management: MySQL (create/delete users, privilege checkboxes, resource limits)
- User management: PostgreSQL (roles, WITH GRANT OPTION, schema-level grants)
- Connection groups/folders, URL import, connection export/import with password protection
- Connection keep-alive ping, query timeout, copy connection as URL

**UAT Criteria:**
- [ ] Setting safe mode to "Password-All" requires password before executing any query
- [ ] DELETE without WHERE triggers warning/block depending on safe mode level
- [ ] Backup PostgreSQL database produces valid dump file, restore from that file works
- [ ] Version mismatch warning appears when pg_dump version differs from server version
- [ ] Create a MySQL user with specific privileges, verify via SHOW GRANTS
- [ ] Connection groups visible on welcome screen, import/export works

**Blocked by:** Phase 1 (DriverRegistry for sidecar integration), Phase 2 (preferences for safe mode config)
**Blocks:** Phase 9 (new engines need backup support where applicable)

---

## Phase 9: Additional Database Engines

**Goal:** Expand database engine support from 3 to 12+ engines using the DriverRegistry abstraction.

**Requirements:** FR-16.1–FR-16.14

**Deliverables (in priority order):**
1. **Tier 1 — Wire-compatible (near-zero cost):** MariaDB, CockroachDB, Amazon Redshift
2. **Tier 2 — New SQL drivers:** MSSQL (tiberius), ClickHouse, DuckDB, Turso/libSQL
3. **Tier 3 — Non-relational:** MongoDB (read-only first, then write), Redis (key-value browser)
4. **Tier 4 — Complex distribution:** Cassandra, BigQuery (GCP auth)
5. **Tier 5 — Deferred to v1.1:** Oracle (Instant Client), Snowflake, Vertica

Per engine deliverables:
- Connection dialog with engine-specific fields
- Schema introspection (get_schema_snapshot)
- Query execution
- Data viewing with pagination
- DDL generation (where applicable)
- Engine-specific feature support matrix documented

**UAT Criteria:**
- [ ] Each Tier 1-4 engine: connect, list tables, view data, execute query, view schema
- [ ] MariaDB/CockroachDB/Redshift work with existing MySQL/PostgreSQL features
- [ ] MSSQL connects with SQL Server authentication and Windows authentication
- [ ] MongoDB shows collections and documents in browsable format
- [ ] Redis shows key browser with key types (string, hash, list, set, sorted set)
- [ ] Per-engine feature matrix documented and accessible in UI

**Blocked by:** Phase 1 (DriverRegistry must be complete), Phase 4 (DDL generation pattern established)
**Blocks:** Phase 10 (metrics needs per-engine get_metrics())

---

## Phase 10: Metrics Dashboard & AI Enhancements

**Goal:** Build the metrics dashboard with SQL-backed widgets and enhance the AI integration for multi-provider support.

**Requirements:** FR-17.1–FR-17.9, FR-18.1–FR-18.4

**Deliverables:**
- Dashboard builder UI: add/remove/resize SQL-backed widgets
- Widget types: bar chart (Recharts), line chart (Recharts), data table, input filter field
- Query parameters for dynamic dashboards
- Configurable refresh rates: timed (N seconds), event-triggered (input → linked widget), manual
- metricsStore with ring buffer (max 60 time points per metric)
- useMetricsPoller hook with configurable interval and silent failure
- Server-side data decimation in Rust (LTTB algorithm, max 2000 data points per widget)
- Per-driver get_metrics() implementation (pg_stat_activity, performance_schema, etc.)
- Widget persistence in dashboards.json
- AI sidebar chat panel (persistent, right sidebar)
- Multi-provider LLM support (OpenAI, Anthropic, Groq, local LLM)
- Configurable LLM provider in preferences
- Table structure context sent to LLM (never row data)

**UAT Criteria:**
- [ ] Create a dashboard with a bar chart showing row counts per table — data renders correctly
- [ ] Line chart with 10,000 row time-series query shows decimated data (< 2000 points) without browser lag
- [ ] Input widget updates linked chart widget on value change
- [ ] Dashboard persists across app restarts
- [ ] AI chat in sidebar generates SQL using selected LLM provider
- [ ] Switching LLM provider in preferences takes effect immediately
- [ ] get_metrics() returns data for PostgreSQL, MySQL, and at least 3 new engines

**Blocked by:** Phase 9 (per-engine get_metrics()), Phase 2 (preferences for LLM config)
**Blocks:** Nothing — this is the final phase

---

## Phase Dependency Graph

```
Phase 1 (Foundation) ──────┬──→ Phase 2 (Preferences & Themes)
                           │         │
                           │         ├──→ Phase 3 (Query Editor)
                           │         │         │
                           │         │         ├──→ Phase 4 (Structure Editing)
                           │         │         │
                           │         │         └──→ Phase 5 (DB Objects & Open Anything)
                           │         │
                           │         ├──→ Phase 7 (Tabs & Shortcuts)
                           │         │
                           │         └──→ Phase 8 (Safe Mode, Backup, Users)
                           │
                           ├──→ Phase 6 (Data Viewing & UX Polish) [can start after Phase 1]
                           │
                           └──→ Phase 9 (Database Engines) [needs Phase 1 + Phase 4]
                                      │
                                      └──→ Phase 10 (Metrics & AI)
```

## Parallelization Opportunities

| Parallel Group | Phases | Rationale |
|---------------|--------|-----------|
| After Phase 2 | Phase 3 + Phase 7 | Editor enhancements and tab/shortcuts are independent |
| After Phase 3 | Phase 4 + Phase 5 + Phase 6 | Structure editing, DB objects, and data UX are independent |
| After Phase 1 | Phase 6 (partial) | Console log and basic UX polish don't depend on Phase 2-3 |
| After Phase 4 | Phase 8 + Phase 9 | Backup/users and new engines are independent |

---

## Success Criteria (v1.0)

- [ ] All P0-Critical requirements implemented and tested
- [ ] All P1-High requirements implemented
- [ ] 80%+ of P2-Medium requirements implemented
- [ ] 12+ database engines connectable (Tier 1-4)
- [ ] Light and dark themes working
- [ ] Full keyboard shortcut coverage with configurable bindings
- [ ] Preferences system fully functional
- [ ] SQL autocomplete with schema awareness working across all core engines
- [ ] Table structure editing with DDL preview working for PostgreSQL, MySQL, SQLite
- [ ] Backup/restore working for PostgreSQL, MySQL, SQLite
- [ ] Metrics dashboard with at least bar chart and line chart widgets
- [ ] No P0 or P1 bugs remaining

---

*Created: 2026-03-02*
*Research basis: STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md, SUMMARY.md*
