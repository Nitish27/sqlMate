# sqlMate v1.0 — TablePlus Feature Parity

## What This Is

sqlMate is a modern, native desktop database management tool built with Tauri (Rust backend) and React (TypeScript frontend). It targets developers who need a fast, elegant GUI for managing relational and NoSQL databases. The v1.0 milestone brings full feature parity with TablePlus across all 20 feature categories — from database engine support to metrics dashboards.

## Core Value

Developers can connect to any major database engine and manage schemas, data, and queries through a polished native GUI that matches or exceeds TablePlus in capability and experience.

## Requirements

### Validated

<!-- Shipped and confirmed valuable — existing in sqlMate v0.4.1 -->

- ✓ PostgreSQL connection with SSL/TLS — existing
- ✓ MySQL connection with SSL/TLS — existing
- ✓ SQLite connection via file path — existing
- ✓ SSH tunneling with password and key-based auth — existing
- ✓ Monaco-based SQL editor with syntax highlighting — existing
- ✓ Query execution (single, all, selected text) — existing
- ✓ Query cancellation — existing
- ✓ Query history (100 items, date-grouped, searchable) — existing
- ✓ SQL formatting — existing
- ✓ Virtualized table data display with react-window — existing
- ✓ Inline cell editing with pending changes — existing
- ✓ Row insert, update, delete, duplicate — existing
- ✓ Copy row as CSV or SQL INSERT — existing
- ✓ Advanced filter system (12+ operators, multi-filter) — existing
- ✓ Sort by column (via filter panel) — existing
- ✓ Column visibility control — existing
- ✓ CSV import with preview and column mapping — existing
- ✓ SQL dump import — existing
- ✓ Export as CSV, JSON, SQL — existing
- ✓ Table structure view (read-only: columns, indexes, constraints) — existing
- ✓ Database create, switch, list — existing
- ✓ Multi-tab workspace — existing
- ✓ Resizable panels (sidebar, center, right) — existing
- ✓ Dark theme UI — existing
- ✓ Connection management with environment tags and colors — existing
- ✓ Safe mode (3 levels: Silent, Alert, Safe) — existing
- ✓ AI text-to-SQL generation (Groq) — existing
- ✓ Streaming query execution with batch processing — existing
- ✓ Pagination with configurable page size — existing
- ✓ Context menu on rows — existing
- ✓ Sidebar tree navigation (tables, views, functions, procedures) — existing
- ✓ Zustand state management with localStorage persistence — existing

### Active

<!-- v1.0 scope — 163 features to achieve TablePlus parity -->

- [ ] All 14 additional database engines (MSSQL, MariaDB, Oracle, CockroachDB, Redshift, Redis, MongoDB, Cassandra, Snowflake, Vertica, BigQuery, ClickHouse, Turso, DuckDB)
- [ ] Full connection management (groups, import/export, URL import, keep-alive, timeout, CLI/deeplink, keychain storage, session restore)
- [ ] Full query editor (autocomplete, auto-uppercase, multi-cursor, split panes, favorites with keyword binding, query parameters, invisible chars, auto-save, font/color customization)
- [ ] Table structure editing GUI (create/alter/drop tables, columns, indexes, foreign keys, constraints, triggers via GUI, DDL generation)
- [ ] Database objects management (create/edit/delete views, functions, procedures, materialized views, rename/drop database)
- [ ] Enhanced data viewing (Quick Look popup, copy as JSON/HTML/Markdown, click-to-sort column headers, alternating rows, FK arrow navigation)
- [ ] Enhanced filtering (quick filter from right-click, FK filter, view generated SQL, configurable defaults, restore last state)
- [ ] Open Anything / spotlight search (Cmd+P fuzzy search across all objects)
- [ ] Tab/workspace management (pin tabs, rename tabs, close others, workspaces, session restore)
- [ ] Toolbar & UI customization (customizable toolbar, light theme, auto-switch theme, syntax color customization, font/size preferences)
- [ ] Sidebar enhancements (pin to top, recent items, toggle sections, system schemas toggle, multi-database sidebar)
- [ ] Console log (full query recording, type filtering, clear, keyboard toggle)
- [ ] Enhanced safe mode (5 levels with password confirmation for destructive queries)
- [ ] Backup & restore (dump to file, restore from file, with configuration)
- [ ] User management (create/delete users, grant/revoke privileges, resource limits — MySQL focus)
- [ ] Metrics board / dashboard (bar charts, line charts, data tables, input fields, query parameters, refresh rates)
- [ ] Enhanced AI/LLM (sidebar chat, multi-provider support, configurable provider in settings)
- [ ] Enhanced import/export (right-click table to import/export, export current page)
- [ ] Full keyboard shortcuts (Cmd+P, Cmd+T, Cmd+W, Cmd+D, Cmd+I, Cmd+S, Cmd+Shift+D, Cmd+Shift+C, Cmd+F, etc.)
- [ ] Preferences system (dedicated window, general tab, fonts & colors tab, connection settings, editor settings)

### Out of Scope

- iOS/mobile app — Desktop-first, mobile is a separate product
- Real-time collaboration — Single-user tool
- Plugin marketplace — Defer to post-v1
- Paid licensing/subscription system — Business concern, not engineering

## Context

- **Current state:** sqlMate v0.4.1 with PostgreSQL, MySQL, SQLite support
- **Tech stack:** Tauri 2.x (Rust) + React 18 + TypeScript + Zustand + Monaco Editor + Tailwind CSS
- **Backend:** Rust with sqlx for connection pooling, serde for serialization
- **Gap analysis:** 163 features identified across 20 categories by comparing with TablePlus documentation
- **Existing patterns:** Uses Tauri commands for backend IPC, Zustand stores for state, react-resizable-panels for layout

## Constraints

- **Tech stack**: Must use existing Tauri + React + Rust architecture — no framework migration
- **Backend**: New database drivers must integrate with existing sqlx pool pattern or equivalent Rust crates
- **Performance**: Virtualized rendering must remain for large datasets — no regressions
- **Compatibility**: Must maintain backward compatibility with existing saved connections and query history (localStorage migration if needed)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Full TablePlus parity as v1.0 target | User wants complete feature match before shipping | — Pending |
| All 14 additional database engines | Maximize user reach, match TablePlus breadth | — Pending |
| Include metrics board in v1 | User explicitly chose to include dashboards | — Pending |
| Comprehensive depth for roadmap | 163 features requires thorough phase structure | — Pending |

---
*Last updated: 2026-03-02 after initialization*
