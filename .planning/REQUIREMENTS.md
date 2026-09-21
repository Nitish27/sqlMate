# sqlMate v1.0 Requirements — TablePlus Feature Parity

## Version Target
- **Current:** v0.4.1
- **Target:** v1.0
- **Scope:** Full TablePlus feature parity (~163 features across 20 categories)

---

## Functional Requirements

### FR-01: Security & Foundation Repair
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-01.1 | Upgrade sqlx from 0.7 to 0.8.1+ to patch RUSTSEC-2024-0363 (PostgreSQL RCE) | P0-Critical | PITFALLS |
| FR-01.2 | Migrate all localStorage persistence to `tauri-plugin-store` with one-time data migration for existing users | P0-Critical | PITFALLS, ARCH |
| FR-01.3 | Refactor ConnectionManager into DriverRegistry with DatabaseDriver trait and enum-based dispatch | P0-Critical | ARCH |
| FR-01.4 | Split monolithic Zustand store into 6 domain stores: connectionStore, workspaceStore, schemaStore, historyStore, settingsStore, uiStore | P0-Critical | ARCH |
| FR-01.5 | Fix test_connection to use options builder pattern instead of URL string interpolation | P1-High | PITFALLS |
| FR-01.6 | Add cargo audit to CI pipeline | P1-High | PITFALLS |

### FR-02: Query Editor
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-02.1 | SQL autocomplete with schema awareness (tables, columns, keywords) per active connection | P0-Critical | GAP, FEATURES |
| FR-02.2 | LanguageServiceManager singleton with connection-keyed schema cache to avoid Monaco global provider bleed | P0-Critical | ARCH, PITFALLS |
| FR-02.3 | Auto-uppercase SQL keywords as user types | P1-High | GAP |
| FR-02.4 | Multi-cursor editing support | P2-Medium | GAP |
| FR-02.5 | Split pane — horizontal editor split (Cmd+Shift+D) | P2-Medium | GAP |
| FR-02.6 | Query favorites with keyword binding (type keyword to insert saved query) | P1-High | GAP, FEATURES |
| FR-02.7 | Favorite query folders for organization | P1-High | GAP |
| FR-02.8 | Query parameters support ($1, :param) | P2-Medium | GAP |
| FR-02.9 | Show invisible characters toggle | P3-Low | GAP |
| FR-02.10 | Auto-save queries while editing | P2-Medium | GAP |
| FR-02.11 | Run Current Statement with intelligent statement detection | P1-High | GAP |
| FR-02.12 | Editor font family and size customization in preferences | P1-High | GAP |
| FR-02.13 | Syntax color customization (comment, string, keyword colors) | P2-Medium | GAP |
| FR-02.14 | Query editor settings panel | P2-Medium | GAP |
| FR-02.15 | Rename query editor tabs | P2-Medium | GAP |
| FR-02.16 | Split query results into separate result tabs | P2-Medium | GAP |

### FR-03: Table Structure Editing (GUI)
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-03.1 | Create new table via GUI (name, columns, datatypes, constraints) | P0-Critical | GAP, FEATURES |
| FR-03.2 | Alter table — add/edit/delete columns via GUI with pending changes model | P0-Critical | GAP, FEATURES |
| FR-03.3 | Rename table via GUI | P1-High | GAP |
| FR-03.4 | Truncate table via GUI with confirmation | P1-High | GAP |
| FR-03.5 | Drop table via GUI with confirmation | P1-High | GAP |
| FR-03.6 | Create/edit/delete indexes via GUI | P1-High | GAP |
| FR-03.7 | Create/edit/delete foreign key constraints via GUI | P1-High | GAP |
| FR-03.8 | NOT NULL constraint toggle via GUI | P1-High | GAP |
| FR-03.9 | PRIMARY KEY editing via GUI | P1-High | GAP |
| FR-03.10 | DEFAULT value editing via GUI | P1-High | GAP |
| FR-03.11 | Create/edit/delete triggers via GUI | P2-Medium | GAP |
| FR-03.12 | Generate CREATE TABLE DDL from existing table | P1-High | GAP |
| FR-03.13 | Generate DROP TABLE and TRUNCATE statements | P2-Medium | GAP |
| FR-03.14 | DDL generation in Rust per driver dialect — NOT in TypeScript | P0-Critical | ARCH |
| FR-03.15 | PendingStructureChange model with preview modal and explicit commit | P0-Critical | FEATURES |
| FR-03.16 | Change table encoding | P3-Low | GAP |

### FR-04: Database Objects Management
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-04.1 | Create/edit/delete views via GUI (name + SQL definition) | P1-High | GAP |
| FR-04.2 | Create/edit/delete functions via GUI | P1-High | GAP |
| FR-04.3 | Create/edit/delete stored procedures via GUI | P1-High | GAP |
| FR-04.4 | Materialized view support | P2-Medium | GAP |
| FR-04.5 | Create database with encoding & collation settings | P2-Medium | GAP |
| FR-04.6 | Rename database via GUI | P2-Medium | GAP |
| FR-04.7 | Drop database via GUI with confirmation | P1-High | GAP |

### FR-05: Data Viewing & Editing
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-05.1 | Quick Look popup for JSON (pretty-print) and BLOB (hex/binary) cells | P1-High | GAP, FEATURES |
| FR-05.2 | Copy cell as JSON, HTML, Markdown table, CSV with headers | P2-Medium | GAP |
| FR-05.3 | Click-to-sort column headers (server-side ORDER BY, not client-sort) | P0-Critical | GAP, FEATURES |
| FR-05.4 | Alternating row background colors (configurable) | P3-Low | GAP |
| FR-05.5 | Estimated row count for performance | P2-Medium | GAP |
| FR-05.6 | Right sidebar toggle for row editing (Space key) | P2-Medium | GAP |
| FR-05.7 | Foreign key cell arrow → filter referenced table | P1-High | GAP, FEATURES |
| FR-05.8 | BLOB column protection — show placeholder, download on click | P1-High | PITFALLS |
| FR-05.9 | Modified value color highlighting (enhanced) | P2-Medium | GAP |
| FR-05.10 | New row color highlighting | P2-Medium | GAP |

### FR-06: Filtering Enhancements
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-06.1 | Quick filter from right-click on cell value | P1-High | GAP |
| FR-06.2 | Quick filter from right-click on column header | P1-High | GAP |
| FR-06.3 | Foreign key quick filter (click FK arrow) | P1-High | GAP |
| FR-06.4 | View generated SQL for active filters | P2-Medium | GAP |
| FR-06.5 | Configurable default filter column and operator | P2-Medium | GAP |
| FR-06.6 | Restore last filter state on reopen | P2-Medium | GAP |

### FR-07: Open Anything / Spotlight Search
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-07.1 | Cmd+P fuzzy search across all objects (tables, views, functions, procedures, databases, schemas, saved queries) | P0-Critical | GAP, FEATURES |
| FR-07.2 | Open result directly in new tab | P1-High | GAP |
| FR-07.3 | Debounced backend search with fuzzy matching | P1-High | ARCH |

### FR-08: Tab/Workspace Management
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-08.1 | Pin tabs (prevent close/overwrite) | P1-High | GAP |
| FR-08.2 | Rename tabs | P1-High | GAP |
| FR-08.3 | Close other tabs / Close tabs to the right | P1-High | GAP |
| FR-08.4 | New empty tab (Cmd+T) | P1-High | GAP |
| FR-08.5 | Cmd+1-9 to jump to specific tab | P2-Medium | GAP |
| FR-08.6 | Multiple workspaces per connection | P2-Medium | GAP |

### FR-09: Toolbar & UI Customization
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-09.1 | Light theme | P0-Critical | GAP, FEATURES |
| FR-09.2 | Auto-switch theme based on OS preference (System mode) | P1-High | GAP |
| FR-09.3 | SQL editor syntax color customization | P2-Medium | GAP |
| FR-09.4 | Data table font/size/padding customization | P2-Medium | GAP |
| FR-09.5 | Customizable toolbar (show/hide items) | P2-Medium | GAP |

### FR-10: Sidebar Enhancements
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-10.1 | Pin tables/views to top of sidebar | P1-High | GAP |
| FR-10.2 | Show recent items section (last 5 opened) | P1-High | GAP |
| FR-10.3 | Toggle function/procedure section visibility | P2-Medium | GAP |
| FR-10.4 | Toggle system schemas visibility (information_schema, pg_catalog) | P2-Medium | GAP |
| FR-10.5 | Show database/connection names in sidebar | P2-Medium | GAP |
| FR-10.6 | Multi-database sidebar with DB icons | P2-Medium | GAP |

### FR-11: Console Log
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-11.1 | Full query log recording (all executed queries including internal meta-queries) | P1-High | GAP, FEATURES |
| FR-11.2 | Filter by query type (meta vs data) | P2-Medium | GAP |
| FR-11.3 | Clear log button | P2-Medium | GAP |
| FR-11.4 | Toggle console with Cmd+Shift+C | P1-High | GAP |

### FR-12: Safe Mode (Enhanced)
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-12.1 | 5-level safe mode: Silent, Alert-All, Alert-Non-Select, Password-All, Password-Non-Select | P1-High | GAP, FEATURES |
| FR-12.2 | Password confirmation for destructive queries in Safe modes | P1-High | GAP |
| FR-12.3 | Destructive query detection (UPDATE/DELETE without WHERE, DROP, TRUNCATE, ALTER) | P1-High | FEATURES |

### FR-13: Backup & Restore
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-13.1 | Database backup to dump file via pg_dump/mysqldump/sqlite3 as Tauri sidecars | P1-High | GAP |
| FR-13.2 | Database restore from dump file with streaming progress | P1-High | GAP |
| FR-13.3 | Server version detection and local binary version mismatch warning | P1-High | PITFALLS |
| FR-13.4 | User-configurable binary path for pg_dump/mysqldump | P2-Medium | PITFALLS |

### FR-14: User Management
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-14.1 | Create/delete database users via GUI | P1-High | GAP |
| FR-14.2 | Grant/revoke privileges (global and per-database) for MySQL | P1-High | GAP, FEATURES |
| FR-14.3 | PostgreSQL role management (role vs user, WITH GRANT OPTION, schema-level grants) | P2-Medium | GAP, FEATURES |
| FR-14.4 | Resource limits (max queries/hour, connections/hour) — MySQL | P2-Medium | GAP |
| FR-14.5 | View/edit existing user permissions | P1-High | GAP |

### FR-15: Connection Management (Enhanced)
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-15.1 | Connection groups/folders to organize connections | P1-High | GAP |
| FR-15.2 | Import connection from URL string (paste postgres://...) | P1-High | GAP |
| FR-15.3 | Export/import connections to file with optional password protection | P1-High | GAP |
| FR-15.4 | Connection keep-alive ping (configurable interval, default 30s) | P2-Medium | GAP |
| FR-15.5 | Query timeout limit setting (configurable, default 300s) | P2-Medium | GAP |
| FR-15.6 | Copy connection as URL for sharing | P2-Medium | GAP |
| FR-15.7 | Keychain-based credential storage (OS-level secure) | P2-Medium | GAP |

### FR-16: Database Engine Support
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-16.1 | MariaDB (wire-compatible with MySQL via sqlx) | P1-High | GAP, STACK |
| FR-16.2 | CockroachDB (wire-compatible with PostgreSQL via sqlx) | P1-High | GAP, STACK |
| FR-16.3 | Amazon Redshift (wire-compatible with PostgreSQL via sqlx) | P1-High | GAP, STACK |
| FR-16.4 | Microsoft SQL Server via tiberius + bb8-tiberius | P1-High | GAP, STACK |
| FR-16.5 | MongoDB via official mongodb v3 driver | P1-High | GAP, STACK |
| FR-16.6 | ClickHouse via official clickhouse crate | P2-Medium | GAP, STACK |
| FR-16.7 | DuckDB via duckdb crate (bundled, no install) | P2-Medium | GAP, STACK |
| FR-16.8 | Turso/libSQL via libsql crate | P2-Medium | GAP, STACK |
| FR-16.9 | Redis via fred v9 | P2-Medium | GAP, STACK |
| FR-16.10 | Cassandra via cdrs-tokio | P2-Medium | GAP, STACK |
| FR-16.11 | BigQuery via gcp-bigquery-client | P2-Medium | GAP, STACK |
| FR-16.12 | Snowflake — defer to v1.1 (LOW confidence driver) | P3-Low | STACK |
| FR-16.13 | Oracle — gate behind setup wizard (requires Instant Client) | P3-Low | STACK |
| FR-16.14 | Vertica — defer to v1.1 (ODBC bridge, LOW confidence) | P3-Low | STACK |

### FR-17: Metrics Board / Dashboard
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-17.1 | Custom dashboard builder with SQL-backed widgets | P1-High | GAP |
| FR-17.2 | Bar chart widget (Recharts) | P1-High | GAP |
| FR-17.3 | Line chart widget (Recharts) | P1-High | GAP |
| FR-17.4 | Data table widget | P1-High | GAP |
| FR-17.5 | Input filter field with event-driven widget refresh | P2-Medium | GAP |
| FR-17.6 | Query parameters for dynamic dashboards | P2-Medium | GAP |
| FR-17.7 | Configurable refresh rates (timed, event, manual) | P2-Medium | GAP |
| FR-17.8 | Server-side data decimation in Rust before chart rendering (max 2000 points) | P1-High | PITFALLS |
| FR-17.9 | Per-driver get_metrics() implementation for system views | P1-High | ARCH |

### FR-18: AI/LLM Enhancements
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-18.1 | Right sidebar persistent chat client for AI | P2-Medium | GAP |
| FR-18.2 | Multi-provider support (OpenAI, Anthropic, local LLM) beyond current Groq-only | P1-High | GAP |
| FR-18.3 | Configurable LLM provider in settings | P1-High | GAP |
| FR-18.4 | Table structure context sent to LLM (not row data) | P1-High | GAP |

### FR-19: Import/Export Enhancements
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-19.1 | Right-click table to import CSV | P2-Medium | GAP |
| FR-19.2 | Right-click table to export as CSV/JSON/SQL | P2-Medium | GAP |
| FR-19.3 | Export current page only via right-click | P2-Medium | GAP |
| FR-19.4 | XLSX export format | P2-Medium | FEATURES |
| FR-19.5 | HTML table export format | P3-Low | FEATURES |
| FR-19.6 | Markdown table export format | P2-Medium | FEATURES |
| FR-19.7 | Streaming import for large files without memory spike | P1-High | FEATURES |

### FR-20: Keyboard Shortcuts
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-20.1 | Cmd+P — Open Anything spotlight search | P0-Critical | GAP |
| FR-20.2 | Cmd+T — New empty tab | P1-High | GAP |
| FR-20.3 | Cmd+W — Close current tab | P1-High | GAP |
| FR-20.4 | Cmd+D — Duplicate row | P1-High | GAP |
| FR-20.5 | Cmd+I — Insert row | P1-High | GAP |
| FR-20.6 | Cmd+S — Commit pending changes | P0-Critical | GAP |
| FR-20.7 | Cmd+Shift+D — Split pane | P2-Medium | GAP |
| FR-20.8 | Cmd+Shift+C — Toggle console | P1-High | GAP |
| FR-20.9 | Cmd+F — Filter rows | P1-High | GAP |
| FR-20.10 | Space — Quick edit in sidebar | P2-Medium | GAP |
| FR-20.11 | Delete key — Delete selected row | P1-High | GAP |
| FR-20.12 | Cmd+, — Open preferences | P1-High | GAP |
| FR-20.13 | Configurable keyboard bindings via preferences | P1-High | FEATURES |

### FR-21: Preferences System
| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-21.1 | Dedicated preferences window (Cmd+,) | P0-Critical | GAP, FEATURES |
| FR-21.2 | General tab (application behavior, connections, SQL editor, table data) | P0-Critical | GAP |
| FR-21.3 | Fonts & Colors tab | P1-High | GAP |
| FR-21.4 | Persistence via tauri-plugin-store (settings.json, connections.json, shortcuts.json) | P0-Critical | ARCH |

---

## Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-01 | No performance regression on large datasets — virtualized rendering must remain | P0-Critical |
| NFR-02 | Backward compatibility with existing saved connections (migration path) | P0-Critical |
| NFR-03 | Cross-platform consistency (Windows, macOS, Linux) | P1-High |
| NFR-04 | IPC payload optimization — stream large results, don't buffer in memory | P1-High |
| NFR-05 | Secure credential handling — no passwords in shell args, use env vars | P0-Critical |
| NFR-06 | DDL generation correctness — per-dialect SQL, tested against live databases | P0-Critical |
| NFR-07 | Schema cache invalidation after DDL operations | P1-High |

---

## Out of Scope (v1.0)

- iOS/mobile app
- Real-time collaboration
- Plugin marketplace
- Biometric safe mode (TouchID/Windows Hello)
- Visual ERD diagram
- Cross-database migration wizard
- Snowflake support (deferred to v1.1)
- Vertica support (deferred to v1.1)
- Session restore (unconfirmed in TablePlus)

---

*Derived from: Gap Analysis (163 features), Research (STACK, FEATURES, ARCHITECTURE, PITFALLS)*
*Last updated: 2026-03-02*
