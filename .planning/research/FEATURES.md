# Feature Landscape: Database Management Tools

**Domain:** Desktop database management tool (TablePlus parity target)
**Researched:** 2026-03-02
**Confidence:** HIGH (primary source: official TablePlus docs, verified secondary sources)

---

## Research Methodology

Primary source: TablePlus official documentation (docs.tableplus.com) — direct page reads.
Secondary sources: Beekeeper Studio docs, DBeaver docs, DataGrip docs, community discussions.
All UX patterns verified against at least two tools where noted.

---

## 1. SQL Autocomplete

### How TablePlus Does It

TablePlus autocomplete is schema-aware and configurable per-connection. It suggests from four
object categories: databases, tables, keywords, and columns. The feature triggers automatically
as you type (no manual trigger required). Configuration is accessed via a gear icon at the
bottom-left of the editor or via Preferences > General.

**Configurable options:**
- Toggle table suggestions on/off
- Toggle keyword suggestions on/off
- Auto-prefix with schema name (e.g., `public.users` vs `users`)
- Auto-uppercase SQL keywords as you type (e.g., `select` becomes `SELECT`)

### How DBeaver Does It

DBeaver ships three interchangeable completion engines (switchable in Window > Preferences >
Editor > SQL Editor > Code Completion):

- **Semantic (recommended):** Analyzes full SQL AST and lexical scopes. Most accurate,
  context-aware. Requires "Enable semantic analysis" and schema read permissions.
- **Legacy:** Position-based suggestions only — no subquery awareness.
- **Combined:** Merges Semantic + Legacy to cover gaps.

DBeaver also supports introspection levels (1-3) to control how much schema metadata is loaded.
Level 1 = object names only; Level 2 = everything except source code; Level 3 = everything.
This matters for large databases where loading all metadata would be too slow.

### How DataGrip Does It

DataGrip builds a full semantic model of the schema (via background introspection) then does
true identifier resolution — it knows that `t.id` in `FROM users t` resolves to `users.id`.
DataGrip also supports SQL refactoring: rename an identifier in a query and the database object
gets renamed, too. Context-aware completions include CTE awareness, subquery scope, and JOIN
target suggestions.

### Monaco Editor Implementation Pattern

Monaco does not natively understand SQL schema. The implementation pattern is:

1. Call `monaco.languages.registerCompletionItemProvider('sql', provider)` on initialization.
2. The provider's `provideCompletionItems` method receives the current model and cursor position.
3. Parse the current word and preceding context to determine whether the cursor is after FROM,
   SELECT, WHERE, JOIN, etc.
4. Return `CompletionItem[]` with `kind: monaco.languages.CompletionItemKind.Class` for tables,
   `Field` for columns, `Keyword` for SQL keywords.
5. The provider can be async — fetch schema from the Rust backend via Tauri invoke on demand.
6. Use `triggerCharacters: ['.', ' ']` to trigger after dot (schema.table) and space.

**Key library option:** `monaco-sql-languages` (DTStack, npm) — provides dialect-aware keyword
completions for standard SQL, BigQuery, Hive, SparkSQL, and others. Can be extended with custom
schema completions via `completionService`.

**Schema refresh challenge:** Monaco registers providers globally per language, not per model.
To support multiple active connections with different schemas, use a Map keyed by connection ID,
store schema data there, and look up the active connection's schema in the provider at call time.

**Confidence:** HIGH for the pattern; MEDIUM for the monaco-sql-languages library's suitability
for all 14 target engines (needs per-dialect validation).

---

## 2. Table Structure Editor (CREATE / ALTER via GUI)

### UX Pattern (TablePlus)

The structure editor is a tab within the table view, not a separate window. Access via:
- Click "Structure" tab at the bottom of the data view
- `Cmd + Shift + ]` keyboard shortcut
- Right-click table name > "Edit Structure"

**Create Table flow:**
1. Click `+` in the left sidebar or right-click > New > Table
2. Enter table name in the top field
3. Click `+ Column` or double-click a blank row to add columns
4. Each column row has: name, datatype, nullable checkbox, default value field
5. Primary key is set via a checkbox column in the row
6. `Cmd + S` commits — generates and executes the `CREATE TABLE` DDL

**Alter Table flow:**
1. Open structure view
2. Double-click any field to edit it inline
3. Changes accumulate as pending (shown in yellow or highlighted)
4. `Cmd + Shift + P` previews the generated ALTER TABLE SQL before executing
5. `Cmd + S` commits the ALTER
6. `Cmd + Shift + Delete` discards all pending changes

**DDL preview:** Available via a "Definition" button in the structure view — shows the full
`CREATE TABLE` statement. Also available via right-click > "Copy Script As" which offers:
`DROP + CREATE`, `TRUNCATE`, Laravel Migration format (via plugin).

**Index management:**
Accessed from the same structure view. Tab or sub-section labeled "Indexes". Add index via `+`
button, choose columns, index type (UNIQUE, BTREE, etc.), and save.

**Foreign key management:**
Also in the structure view. Tab or sub-section for "Foreign Keys" / "Constraints". Choose the
local column, the referenced table, the referenced column, and ON DELETE / ON UPDATE actions.

**Column attributes available:**
Name, data type, nullable (checkbox), default value. Note: constraints like CHECK, GENERATED
columns, and COMMENT attributes are not prominently documented as GUI-editable in TablePlus
— they may require raw DDL.

### What Beekeeper Studio Does Differently

Beekeeper Studio has a dedicated "No-Code Table Creator" that is visually distinct from the
data view. It also supports:
- Partition creation for PostgreSQL
- `auto_increment` toggle as a first-class UI element
- Visual ERD (Entity Relationship Diagram) auto-generated from live schema

### Key UX Principle: Pending Changes Model

ALL tools that do GUI table editing use a **pending changes model**, not immediate execution.
This is the single most important UX pattern:
- Changes accumulate in a local "staging" state
- A diff/preview shows exactly what SQL will run
- User explicitly commits (`Cmd+S`) or discards (`Cmd+Shift+Delete`)
- This prevents accidental schema corruption

**Confidence:** HIGH (directly verified from TablePlus docs, corroborated by Beekeeper Studio).

---

## 3. Metrics Dashboard / Board

### TablePlus Implementation

The Metrics Board is a dedicated view, not an overlay on existing data. Access via toolbar
button labeled "Metrics" or equivalent.

**Widget types available:**
- Bar chart
- Line chart
- Data table (tabular query result)
- Input field (interactive filter, linked to a chart/table)

**How data populates widgets:**
Every widget is backed by a raw SQL query. You write the SQL, the widget executes it and
renders the result as the chart type. No drag-and-drop data picker — SQL is the data source.

**Adding a widget:**
Click `+` button or right-click in the Metrics Board canvas > select chart type > enter SQL
query > configure refresh behavior.

**Refresh strategies (per widget):**
- Timed: Auto-refresh every N seconds (configurable)
- Event-triggered: Refresh when an Input Field widget sends an event (i.e., the user types
  a filter value and another widget refreshes based on it)
- Manual: No auto-refresh; user clicks the refresh button

**Input field widgets:**
Interactive elements that send filter values to linked chart/table widgets. Requires:
1. The target chart/table must have a query parameter (e.g., `WHERE region = :region`)
2. The target widget must have "Refresh on Event" enabled
3. The input field maps to the parameter name

**Architecture implication:** This is essentially a lightweight internal dashboard builder —
a subset of tools like Metabase/Redash, but embedded in the DB tool. Each widget is an
independent SQL query with its own refresh cycle.

**Confidence:** HIGH (verified directly from TablePlus docs.tableplus.com/gui-tools/metrics-board).

---

## 4. Backup and Restore

### TablePlus Workflow

TablePlus backup/restore uses the native CLI dump tools of each database engine. The GUI
wraps `pg_dump` (PostgreSQL) and `mysqldump` (MySQL) — it doesn't implement its own binary format.

**Backup initiation:**
- Welcome screen > Backup button, OR
- File > Backup from an active connection

**Backup workflow:**
1. Choose connection and target database
2. Configure options (format, tables to include, compression)
3. Choose destination folder on disk
4. Run — produces a dump file (.sql or native format)

**Restore workflow:**
1. Welcome screen > Restore button, OR
- File > Restore from active connection
2. Choose connection and target database
3. Configure options
4. Select the backup file
5. Run — executes the restore against the selected database

**What the docs don't specify:** Exact compression options, partial restore (table subset),
cross-version restore compatibility warnings. These are gaps — likely handled by the underlying
pg_dump/mysqldump options which vary by version.

**Standard formats observed across DB tools:**
- PostgreSQL: `.sql` (pg_dump plain), `.dump` (pg_dump custom), `.tar` (pg_dump tar format)
- MySQL: `.sql` (mysqldump)
- SQLite: `.sql` (dump) or `.db` file copy

**DBeaver approach:** Exposes full pg_dump / mysqldump flags in a GUI wizard — more granular
than TablePlus (schema-only, data-only, exclude tables, compression level, jobs count).

**DataGrip approach:** Similar wizard with explicit format selection (plain SQL vs custom binary).

**Confidence:** MEDIUM (TablePlus backup docs are sparse; underlying tool behavior inferred from
industry standard practice with pg_dump/mysqldump).

---

## 5. User and Privilege Management

### TablePlus: MySQL-Only (Current)

As of the documentation reviewed, user management in TablePlus is available **for MySQL only**.
It is not implemented for PostgreSQL, MSSQL, or other engines.

**Access:** Connection > User Management, or toolbar button.

**Create user flow:**
1. Click `+` in the Users panel
2. Enter username and password
3. Choose privilege scope:
   - **Global privileges:** Applies to all databases (equivalent to GRANT ... ON *.* TO)
   - **Database privileges:** Grant per-database with specific permission checkboxes

**Privilege checkboxes available (MySQL):**
SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, RELOAD, SHUTDOWN, PROCESS, FILE, GRANT OPTION,
REFERENCES, INDEX, ALTER, SHOW DATABASES, SUPER, CREATE TEMPORARY TABLES, LOCK TABLES,
EXECUTE, REPLICATION SLAVE, REPLICATION CLIENT, CREATE VIEW, SHOW VIEW, CREATE ROUTINE,
ALTER ROUTINE, CREATE USER, EVENT, TRIGGER, CREATE TABLESPACE.

**Resource limits (MySQL):**
- Max queries per hour
- Max updates per hour
- Max connections per hour

**Delete user:** Select user in list > click `-` > save.

### PostgreSQL User Management (Broader Context)

PostgreSQL has a richer privilege model than MySQL. The pgAdmin Grant Wizard (industry reference)
implements:
- Role-based privilege model (roles can be users or groups)
- Object selection (tables, views, sequences, schemas, functions, procedures)
- Privilege checkboxes per object (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)
- Schema-level grants
- WITH GRANT OPTION (allow grantee to grant to others)

**Key difference from MySQL:** PostgreSQL uses ROLES not USERS as the primary concept. A role
with LOGIN is a user. A role without LOGIN is a group. Any GUI for PostgreSQL must model this
correctly — a "Create User" dialog should offer a LOGIN checkbox.

**Confidence:** HIGH for MySQL (directly from TablePlus docs). MEDIUM for PostgreSQL scope
(from pgAdmin docs and PostgreSQL documentation, not directly from TablePlus).

---

## 6. Open Anything / Command Palette

### TablePlus Implementation

**Trigger:** `Cmd+P` or click the search/magnifying glass icon in the toolbar.

**Scope of search:** Eight object types —
Database, Schema, Table, View, Materialized View, Function, Procedure, Saved Queries.

**Search method:** Fuzzy matching — types partial names, abbreviations, camelCase fragments.
Results navigate via arrow keys; open with Enter or double-click.

**Behavior:** Functions like macOS Spotlight — a floating modal over the workspace.

**Limitation (community-reported):** Does not search across multiple disconnected databases
simultaneously. Searches only the currently connected database.

### Beekeeper Studio Implementation

Beekeeper Studio mirrors the same pattern:
- `Ctrl/Cmd+P` to open
- Fuzzy matches tables, views, and saved queries
- Hit Enter to open

**Beekeeper limitation:** Does not include functions/procedures in the search scope (as of
community reports — less comprehensive than TablePlus).

### DBeaver Status

As of 2025, DBeaver does NOT have a command palette. There is an open community discussion
requesting it (Discussion #35599). DBeaver relies on traditional menus and the Navigator panel.

### Implementation Pattern for sqlMate

A floating modal (`position: fixed`, centered) that:
1. Accepts typed input
2. Calls a Rust backend function with the search term (debounced ~100ms)
3. Backend queries `information_schema` / `pg_catalog` for matching objects
4. Returns typed results (table, view, function, etc.) with icons per type
5. Keyboard navigation (arrow keys + Enter to open)
6. Escape to dismiss

**Confidence:** HIGH (directly from TablePlus docs and Beekeeper Studio docs).

---

## 7. Tab and Workspace Management

### TablePlus Tab Behavior

TablePlus uses a "smart replacement" model for tabs:

- If the current tab is unmodified, clicking a new object replaces it in the current tab
  (prevents tab sprawl for casual browsing)
- If the current tab HAS pending changes, a new tab is forced
- Double-clicking an object always pins it to its own tab
- Right-click > "Open in New Tab" forces a new tab regardless

**Tab operations:**
- Create empty tab: `Cmd+T`
- Close tab: `Cmd+W` or right-click > Close, or X button
- Rename tab: Right-click > Rename Tab (important for multiple query editors)
- "Close other tabs": Context menu
- "Close tabs to the right": Context menu
- Navigate left/right: `Cmd+[` and `Cmd+]`
- Jump to tab N: `Cmd+1` through `Cmd+9`

**Workspace concept:**
A workspace = one database connection's set of open objects. Multiple workspaces can exist
in multiple windows. Switching databases (`Cmd+K`) can open in a new workspace or replace
the current one.

**Pinned tabs:** Tabs with pending changes are auto-pinned. Double-clicking an object
explicitly pins it (tab doesn't auto-replace on next object click).

### Session Restore

TablePlus documentation does NOT explicitly describe session restore (reopening last open tabs
on app launch). This is a known user request (GitHub Issue #1260: "Save/Restore Workspace/Session").
The feature is community-requested but not confirmed as implemented.

**DataGrip approach (for contrast):** Full session management — sessions are named, saved, and
can be switched per file. Multiple named sessions per connection are supported.

**Confidence:** HIGH for tab operations (directly from docs). LOW for session restore in
TablePlus (not confirmed as available — may be missing).

---

## 8. Import and Export

### Standard Formats Across Tools

| Format | Export | Import | Notes |
|--------|--------|--------|-------|
| CSV | All tools | All tools | Table stakes |
| JSON | Most tools | Some tools | Common |
| SQL dump | All tools | All tools | Via mysqldump/pg_dump |
| Excel (XLSX) | DataGrip, DBeaver, Beekeeper | Rarely | Nice-to-have |
| Markdown | DataGrip | No | Niche |
| XML | DataGrip, DBeaver | Rarely | Niche |
| HTML | DBeaver, some | No | Niche |

### TablePlus Export

Exports offered: CSV, JSON, SQL. Access via right-click on table > Export or via toolbar.

**Export current page:** TablePlus supports exporting the current page of data (not just entire
table), which is important for large tables where full export is impractical.

### Beekeeper Studio Export/Import

**Export:** CSV, JSON, SQL, Excel — in two clicks from any table, view, or query result.

**Import:**
- Intelligent CSV detection: auto-determines delimiter, encoding, column mapping
- Append to existing table OR truncate first
- Streaming import: handles large files without memory issues

### DBeaver Import/Export

Most comprehensive: supports TXT, CSV, JSON, XML, Markdown, Excel, HTML, and more.
Export can target another table, a file, or a completely different database (cross-engine migration).

### Standard Import UX Pattern

Best-in-class CSV import flow (based on Beekeeper Studio):
1. Select target table (or create new)
2. Upload/choose file
3. Preview first N rows with auto-detected delimiter and encoding
4. Column mapping UI: source CSV column → target DB column, with type preview
5. Choose mode: Append / Truncate then Insert / Upsert
6. Streaming execute with progress indicator and row count

**Confidence:** HIGH for CSV/JSON/SQL (universal). MEDIUM for Excel/XML/HTML (tool-specific).

---

## 9. Safe Mode and Code Review

### TablePlus: Five Levels

TablePlus implements the richest safe mode system of the tools surveyed:

| Level | Name | Behavior |
|-------|------|----------|
| 0 | Silent | Execute immediately, no warnings |
| 1 | Alert Mode 1 | Warning dialog before ALL queries |
| 2 | Alert Mode 2 | Warning dialog except SELECT/EXPLAIN |
| 3 | Safe Mode 1 | Database password required before ALL queries |
| 4 | Safe Mode 2 | Database password required except SELECT/EXPLAIN |

**Authentication options for Safe Mode:**
- Database password (typed each time)
- Device password (macOS login password) — enabled in Preferences > Crash & Security
- TouchID — enabled in the same location

**Code Review (separate from Safe Mode):**
All GUI operations (editing data, altering structure) accumulate as pending changes with NO
immediate execution. The workflow is:

1. Make changes in the GUI (edit cells, add columns, etc.)
2. Changes appear highlighted/pending (yellow for modified cells)
3. `Cmd+Shift+P` opens a "Preview Changes" modal showing the exact SQL that will run
4. `Cmd+S` commits the changes (executes the SQL)
5. `Cmd+Shift+Delete` discards all pending changes

**Destructive query detection:**
Based on community reports and the safe mode documentation, queries requiring elevated safe mode
include: UPDATE (without WHERE), DELETE (without WHERE), DROP, TRUNCATE, ALTER. SELECT and
EXPLAIN are always considered safe.

**Practical UX implication:** The pending changes model combined with the preview modal means
that even a user who makes GUI-driven changes (not writing raw SQL) can see exactly what DDL
will execute before it runs. This is a core trust-building feature.

**Confidence:** HIGH (directly from docs.tableplus.com/gui-tools/code-review-and-safemode/safe-mode).

---

## 10. Console Log

### TablePlus Implementation

The Console Log is a panel (toggled via `Cmd+Shift+C`) that records every query sent to the
database engine — not just user-typed queries, but also internal meta-queries that the tool
sends automatically (e.g., schema introspection, session setup, pagination queries).

**Filter options:**
- All queries (meta + data)
- Meta queries only (system/introspection queries)
- Data queries only (user-generated SQL)

**Clear button:** Wipes the accumulated log for the current session.

**Use case:** Essential for debugging unexpected behavior ("why did TablePlus send that query?")
and for learning what SQL the GUI operations generate.

**Confidence:** HIGH (directly from docs.tableplus.com/gui-tools/the-interface/console-log).

---

## 11. Preferences System

### TablePlus Preference Tabs

Accessible via `Cmd+,` in a dedicated preferences window:

| Tab | Contents |
|-----|---------|
| General > Application | Theme, language, startup behavior, keep-alive ping interval |
| General > Connections | Default timeouts, SSH options |
| General > Table Data | Pagination size, alternating row colors |
| General > SQL Editor | Autocomplete toggles, auto-uppercase keywords, invisible chars |
| General > CSV File | Default CSV delimiter, encoding |
| Fonts & Colors | Theme (Light/Dark/Auto), editor font/size, syntax highlight colors, data table font/padding |
| Crash & Security | TouchID/device password for safe mode unlock |
| Keymap | Keyboard shortcut customization |
| Plugins | Plugin management |
| DBngin | Integration with DBngin (local DB manager) |

**Fonts & Colors detail:**
- Theme: Light, Dark, System (auto-switch)
- Editor font family and size
- Syntax highlighting colors: comments, numbers, string literals (single/double/backtick),
  reserved keywords, current query highlight, selection background, error highlight
- Data table: font, size, row padding
- Row state colors: soft-deleted rows, modified rows, new rows

**Confidence:** HIGH (directly from docs.tableplus.com/preferences/fonts-and-colors and
related preference pages).

---

## 12. Connection Management

### TablePlus Advanced Connection Features

Beyond basic host/port/user/password, TablePlus supports:

**Organization:**
- Connection groups/folders for grouping related connections
- Color-coded environments (already in sqlMate)
- Tag labeling

**Connection options:**
- Keep-alive ping (configurable interval, default 30s)
- Connection timeout
- Keychain storage (macOS) for credentials — not stored in plaintext config
- SSH tunneling with password or key-based auth (already in sqlMate)

**Import/Export connections:**
- Export connections list to a file
- Import connections from a file (for team sharing)

**URL import:**
- Parse a database URL string (e.g., `postgres://user:pass@host/db`) and auto-populate fields

**Deep links / CLI:**
TablePlus supports custom URL scheme (`tableplus://`) for opening connections from CLI or
other apps.

**Session restore:**
Not confirmed as implemented — this is a known gap/request.

**Confidence:** MEDIUM (some features inferred from documentation structure and community reports;
not all explicitly documented on the pages reviewed).

---

## 13. Sidebar and Navigation

### TablePlus Sidebar Features

**Object types shown:**
Tables, Views, Materialized Views, Functions, Stored Procedures, Triggers (per engine).

**Organization options (documented or community-requested):**
- Pin objects to top of list
- Toggle system schemas (hide/show `information_schema`, `pg_catalog`, etc.)
- Recent items section
- Multi-database sidebar (show objects from multiple databases in one sidebar)
- Collapsible sections per object type

**Sidebar search:**
Local fuzzy search box filters the current sidebar view — different from Open Anything which
searches the database.

**Confidence:** MEDIUM (documented features mixed with community requests — need to validate
which are shipped vs. requested).

---

## 14. Data Viewing Enhancements

### Quick Look

Triggered by: right-click > "Quick Look Editor" OR middle mouse button click on a cell.

**Supported data:** JSON (prettified with syntax highlighting), BLOB (binary view or hex),
long text fields.

**Editing:** The feature is called "Quick Look Editor" suggesting it supports editing in the
expanded view, but the documentation doesn't detail the edit workflow explicitly.

### Copy Row As

TablePlus supports copying a row's data in multiple formats:
- CSV
- SQL INSERT
- JSON (documented as a feature target)
- HTML (documented as a feature target)
- Markdown (documented as a feature target)

### FK Navigation

Clicking an FK value should navigate to the referenced row in the referenced table. This is
a documented feature in Beekeeper Studio ("clickable foreign key relationships") and DataGrip.
TablePlus has this in their feature set as "FK arrow navigation."

**UX pattern:** A small arrow/link icon appears in the FK cell on hover. Clicking it opens the
referenced table with a filter pre-applied showing only the referenced row.

### Column Click-to-Sort

Clicking a column header sorts by that column. This is table-stakes — all tools implement it.
TablePlus's sort is applied as a query ORDER BY (server-side), not client-side sorting of cached
data.

### Alternating Row Colors

A visual aid for reading dense tables. Configurable in Preferences > Table Data.

**Confidence:** HIGH for Quick Look, Copy Row As, click-to-sort. MEDIUM for FK navigation
specifics in TablePlus (pattern confirmed from Beekeeper Studio docs; TablePlus behavior inferred).

---

## Table Stakes vs. Differentiators

### Table Stakes (Users Expect, Missing = Incomplete Product)

| Feature | Why Expected | Complexity | Current State in sqlMate |
|---------|--------------|------------|--------------------------|
| SQL autocomplete (schema-aware) | Every DB tool has it | High | Missing |
| Table structure editor (create/alter) | Core DB management | High | Read-only only |
| Click-to-sort column headers | Universal UX | Low | Missing |
| Foreign key navigation (click to related row) | DBeaver, Beekeeper, DataGrip all have it | Medium | Missing |
| Cmd+P / Open Anything | TablePlus, Beekeeper have it | Medium | Missing |
| Tab rename, pin, close others | Universal tab UX | Low | Missing |
| Backup/Restore UI | Core DB tool | Medium | Missing |
| Multiple themes (light/dark/auto) | Universal expectation 2025 | Low | Dark only |
| Preferences window | All tools have it | Medium | Missing |
| CSV import with column mapping preview | Standard | Medium | Partial (basic import exists) |
| Quick Look / row detail popup | TablePlus standard | Low-Medium | Missing |
| Console log (query recording) | TablePlus, DBeaver | Low | Missing |
| Keyboard shortcuts coverage (full set) | Power user expectation | Medium | Partial |
| Export as Excel | Beekeeper, DBeaver | Low | Missing |

### Differentiators (Not Expected, But Valued)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Metrics dashboard (SQL-backed widgets) | Internal dashboarding without Metabase | High | Unique to TablePlus among peers |
| Safe mode (5 levels with biometric) | Data safety for prod connections | Medium | TablePlus signature feature |
| AI text-to-SQL (already exists) | Reduces SQL barrier | Medium | Already in sqlMate |
| Auto-uppercase SQL keywords | Stylistic preference, popular | Low | Simple Monaco transform |
| Invisible characters display | Debugging whitespace issues | Low | Niche but appreciated |
| Connection URL import | Dev workflow speed | Low | Very useful |
| Copy row as Markdown/HTML | Sharing query results | Low | Useful for developers |
| Query parameters with input fields | Reusable parameterized queries | Medium | DBeaver, Databricks have it |

### Anti-Features (Explicitly Avoid)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Auto-execute on GUI click | Data loss risk | Always use pending changes model |
| Global completion provider without schema isolation | Wrong suggestions for multi-connection | Use Map keyed by connection ID |
| Confirmation dialogs on every action | UX fatigue | Use safe mode levels (user chooses) |
| Full-screen only structure editor | Blocks data view context | Embed structure as a tab/panel |
| Import that loads entire file into memory | Crashes on large files | Stream imports in chunks |
| Hardcoded keyboard shortcuts | Power user alienation | Make shortcuts configurable |
| Privilege management that ignores role model | Wrong for PostgreSQL | Model roles vs. users separately |

---

## Feature Dependencies

The following dependencies constrain phase ordering:

```
SQL autocomplete → Schema introspection must be fast and cached
                 → Monaco registerCompletionItemProvider integration

Structure editor → Pending changes model (already exists for data)
               → DDL generation (Rust-side per engine)
               → Preview modal (can reuse Code Review pattern)

Metrics dashboard → SQL query execution (exists)
                 → Chart rendering library (need to add)
                 → Widget persistence (need new storage)

User management → Connection-level auth (exists)
              → Per-engine privilege model (MySQL first, PostgreSQL after)

Backup/restore → CLI tool detection (pg_dump, mysqldump must be on PATH or bundled)
              → File system access (Tauri fs API)

Open Anything → Schema object index (must be queried from backend)
             → Fuzzy search algorithm (client-side fuse.js or server-side)

Preferences window → All features that are currently hardcoded need to read from prefs store
```

---

## MVP Recommendation

For TablePlus parity, the non-negotiable v1.0 features in priority order:

**Tier 1 — Core completeness (without these, the tool feels alpha):**
1. SQL autocomplete with schema awareness
2. Table structure editor (create, alter, drop columns/indexes/FKs via GUI)
3. Open Anything (`Cmd+P` fuzzy search across all DB objects)
4. Full keyboard shortcut coverage
5. Multiple themes (light/dark/auto-switch)
6. Preferences window

**Tier 2 — Quality of life (polish, users notice the absence):**
7. Quick Look popup for JSON/BLOB cells
8. FK navigation (click FK value → opens related row)
9. Click-to-sort column headers
10. Console log
11. Tab management (pin, rename, close others)
12. Export as additional formats (XLSX, HTML, Markdown rows)
13. Import UI improvements (column mapping preview, truncate option)

**Tier 3 — Feature completeness (matches TablePlus fully):**
14. Backup/Restore UI (wrapping pg_dump/mysqldump)
15. User management (MySQL first)
16. Metrics dashboard
17. Enhanced safe mode (biometric auth, 5 levels)
18. Connection management enhancements (groups, URL import, export/import connections)
19. Sidebar enhancements (pin, recent, system schema toggle)
20. Multi-database engine support (14 additional engines)

**Defer entirely:**
- Visual ERD diagram (Beekeeper has it, TablePlus does not — out of scope for parity)
- Cross-database migration wizard (DBeaver specialty — out of scope)
- Plugin system (post-v1)

---

## Sources

- [TablePlus Autocomplete Documentation](https://docs.tableplus.com/query-editor/autocomplete) — HIGH confidence
- [TablePlus Table Basics](https://docs.tableplus.com/gui-tools/working-with-table/table) — HIGH confidence
- [TablePlus Column Management](https://docs.tableplus.com/gui-tools/working-with-table/column) — HIGH confidence
- [TablePlus Metrics Board](https://docs.tableplus.com/gui-tools/metrics-board) — HIGH confidence
- [TablePlus Backup and Restore](https://docs.tableplus.com/gui-tools/backup-and-restore) — HIGH confidence (sparse detail)
- [TablePlus User Management](https://docs.tableplus.com/gui-tools/user-management) — HIGH confidence
- [TablePlus Open Anything](https://docs.tableplus.com/gui-tools/open-anything) — HIGH confidence
- [TablePlus Safe Mode](https://docs.tableplus.com/gui-tools/code-review-and-safemode/safe-mode) — HIGH confidence
- [TablePlus Console Log](https://docs.tableplus.com/gui-tools/the-interface/console-log) — HIGH confidence
- [TablePlus Multi-Tabs/Workspaces](https://docs.tableplus.com/gui-tools/the-interface/multi-tabs-workspaces-windows) — HIGH confidence
- [TablePlus Shortcut Keys](https://docs.tableplus.com/utilities/shortcut-keys) — HIGH confidence
- [TablePlus Fonts & Colors](https://docs.tableplus.com/preferences/fonts-and-colors) — HIGH confidence
- [TablePlus Quick Look](https://docs.tableplus.com/gui-tools/the-interface/quick-look) — HIGH confidence
- [DBeaver SQL Assist and Auto Complete](https://dbeaver.com/docs/dbeaver/SQL-Assist-and-Auto-Complete/) — HIGH confidence
- [DataGrip Introspection Levels](https://www.jetbrains.com/help/datagrip/introspection-levels.html) — HIGH confidence
- [DataGrip Code Refactoring](https://www.jetbrains.com/help/datagrip/refactoring-source-code.html) — HIGH confidence
- [Beekeeper Studio Features](https://www.beekeeperstudio.io/features) — HIGH confidence
- [Beekeeper Studio Import/Export](https://www.beekeeperstudio.io/features/import-export) — HIGH confidence
- [pgAdmin Grant Wizard](https://www.pgadmin.org/docs/pgadmin4/8.14/grant_wizard.html) — HIGH confidence
- [Monaco SQL Languages (DTStack)](https://github.com/DTStack/monaco-sql-languages/blob/main/README.md) — MEDIUM confidence (library suitability needs validation)
- [Monaco Editor Discussion #4011 — Schema Autocomplete](https://github.com/microsoft/monaco-editor/discussions/4011) — HIGH confidence (confirms schema autocomplete requires custom implementation)
- [DBeaver Command Palette Discussion #35599](https://github.com/orgs/dbeaver/discussions/35599) — MEDIUM confidence (confirms DBeaver lacks command palette)
