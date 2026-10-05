# Architecture Patterns

**Project:** sqlMate v1.0
**Domain:** Desktop database management GUI (Tauri 2.x + React 18 + Rust)
**Researched:** 2026-03-02
**Overall confidence:** HIGH (patterns verified against official docs and live codebases)

---

## Current Architecture Diagnosis

Before recommending patterns, this is what the current code reveals:

**ConnectionManager problem:** Three separate `HashMap<Uuid, XxxPool>` fields (one per database type). Adding a 14th database engine would require a 14th field, a new match arm in every method, and changes to every Tauri command. This is the primary structural blocker for v1.0.

**QueryEngine problem:** One giant file with match arms duplicated for every operation across Postgres, MySQL, and SQLite. Adding CockroachDB would require forking every match arm. This pattern does not scale.

**State store problem:** One monolithic Zustand store with 40+ fields. It already has conflation between connection-level state (`activeConnectionId`) and tab-level state (`activeTabId`) without a clean separation layer. Adding workspaces, metrics, and settings will make this unmanageable.

**Monaco Editor problem:** Currently set to `defaultLanguage="sql"` with no completion provider. This must be replaced with a proper dialect-aware language service layer.

---

## Recommended Architecture

### High-Level Layering

```
Frontend (React / TypeScript)
  Layer 1: UI Components
  Layer 2: Domain Stores (Zustand slices per domain)
  Layer 3: Tauri IPC Bridge (typed invoke wrappers)
        |
        | Tauri Commands (typed, stable surface)
        |
Rust Backend
  Layer 4: Command Handlers (thin: validate + dispatch)
  Layer 5: Driver Registry (runtime dispatch via enum)
  Layer 6: Driver Implementations (one module per engine)
  Layer 7: External Drivers (sqlx, redis-rs, mongodb, libpq, etc.)
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| DriverRegistry | Holds all active connections, dispatches to the correct driver | QueryEngine, BackupService, MetricsCollector |
| DatabaseDriver (trait) | Per-engine implementation of all schema + query operations | DriverRegistry |
| CommandHandlers (lib.rs) | Tauri commands — thin validation + AppState dispatch | DriverRegistry |
| AppState | Global Rust state — DriverRegistry + active query tokens | CommandHandlers |
| LanguageServiceManager | Registers Monaco completion providers per dialect | SQLEditor component |
| SchemaCache | Holds per-connection schema for autocomplete | LanguageServiceManager |
| BackupService | Spawns pg_dump/mysqldump subprocesses, streams events | Tauri window.emit |
| SettingsStore (TS) | Reads/writes tauri-plugin-store JSON files | UI settings components |
| CommandPalette | Fuzzy-searches across connections, tables, commands | All Zustand stores |

---

## 1. Multi-Database Driver Architecture (Rust)

### The Core Problem with the Current Approach

The current `ConnectionManager` uses three typed `HashMap` fields. `sqlx`'s `Database` trait is explicitly documented as **not dyn-compatible** — you cannot use `Box<dyn Database>`. The `AnyPool` escape hatch exists but loses all compile-time query checking and has significant type-system limitations.

**Verdict:** Do not use `sqlx::AnyPool`. Do not try to build a `Box<dyn Database>`. Use an **enum-based driver dispatch pattern** instead.

### Recommended Pattern: Enum Driver Dispatch

Rust's `enum_dispatch` crate delivers up to 10x faster dispatch than `dyn Trait` vtable calls, while allowing a closed but easily-extensible set of drivers. Since all 14+ target engines are known at compile time, this is the correct choice.

```rust
// src-tauri/src/drivers/mod.rs

use async_trait::async_trait;
use uuid::Uuid;
use crate::core::{QueryResult, TableStructure, SidebarItem, ConnectionConfig};

/// The central abstraction every database engine must implement.
/// async_trait is required because RPITIT/AFIT cannot be used with dyn dispatch.
/// Note: Rust 1.75+ stabilized async fn in traits for static dispatch only;
/// for the enum pattern below, async_trait is still needed on the trait.
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    // Lifecycle
    async fn connect(&self, config: &ConnectionConfig, password: Option<&str>) -> anyhow::Result<()>;
    async fn disconnect(&self) -> anyhow::Result<()>;
    async fn ping(&self) -> anyhow::Result<()>;

    // Schema introspection
    async fn get_databases(&self) -> anyhow::Result<Vec<String>>;
    async fn get_sidebar_items(&self) -> anyhow::Result<Vec<SidebarItem>>;
    async fn get_table_structure(&self, table: &str) -> anyhow::Result<TableStructure>;
    async fn get_table_metadata(&self, table: &str) -> anyhow::Result<serde_json::Value>;

    // Query execution
    async fn execute_query(&self, sql: &str, page: u32, page_size: u32) -> anyhow::Result<QueryResult>;
    async fn execute_mutation(&self, sql: &str) -> anyhow::Result<u64>;

    // Database info for autocomplete
    async fn get_schema_snapshot(&self) -> anyhow::Result<SchemaSnapshot>;

    // Engine metadata
    fn driver_type(&self) -> DriverType;
    fn connection_id(&self) -> Uuid;
}

/// DriverType is the discriminant used to select dialect-specific SQL and UI behavior.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DriverType {
    Postgres,
    MySQL,
    MariaDB,
    SQLite,
    CockroachDB,
    Redshift,
    MSSQL,
    Oracle,
    ClickHouse,
    DuckDB,
    Redis,
    MongoDB,
    Cassandra,
    Elasticsearch,
}

/// The DriverConnection enum wraps all concrete driver types.
/// This is the enum_dispatch target — static dispatch, zero vtable overhead.
pub enum DriverConnection {
    Postgres(PostgresDriver),
    MySQL(MySQLDriver),
    SQLite(SQLiteDriver),
    Redis(RedisDriver),
    MongoDB(MongoDriver),
    // ... one variant per engine
}

/// DriverRegistry replaces ConnectionManager.
/// Keyed by connection UUID, holds the correct driver variant.
pub struct DriverRegistry {
    connections: Arc<Mutex<HashMap<Uuid, DriverConnection>>>,
    configs: Arc<Mutex<HashMap<Uuid, ConnectionConfig>>>,
}

impl DriverRegistry {
    pub async fn connect(&self, config: ConnectionConfig, password: Option<String>) -> anyhow::Result<()> {
        let driver = self.build_driver(&config, password.as_deref()).await?;
        let mut conns = self.connections.lock().await;
        conns.insert(config.id, driver);
        Ok(())
    }

    pub async fn with_driver<F, R>(&self, id: &Uuid, f: F) -> anyhow::Result<R>
    where
        F: FnOnce(&DriverConnection) -> anyhow::Result<R>,
    {
        let conns = self.connections.lock().await;
        let driver = conns.get(id).ok_or_else(|| anyhow::anyhow!("Connection {} not found", id))?;
        f(driver)
    }
}
```

**Adding a new engine** requires: one new `DriverConnection` variant + one new `impl DatabaseDriver for XxxDriver` module. No existing match arms change.

### Driver Module Layout

```
src-tauri/src/
  drivers/
    mod.rs          (DatabaseDriver trait, DriverType enum, DriverRegistry)
    postgres.rs     (PostgresDriver — wraps PgPool)
    mysql.rs        (MySQLDriver — wraps MySqlPool)
    sqlite.rs       (SQLiteDriver — wraps SqlitePool)
    cockroachdb.rs  (CockroachDriver — wraps PgPool with different dialect flags)
    redis.rs        (RedisDriver — wraps redis::aio::MultiplexedConnection)
    mongodb.rs      (MongoDriver — wraps mongodb::Client)
    mssql.rs        (MSSQLDriver — wraps tiberius or sqlx mssql)
    clickhouse.rs   (ClickHouseDriver — wraps clickhouse-rs)
    duckdb.rs       (DuckDBDriver — wraps duckdb crate)
```

### Non-SQL Driver Notes

- **Redis:** `redis-rs` with `tokio-comp` feature. Use `MultiplexedConnection` — it is cheaply cloneable and safe to share across tasks without a pool. The `bb8-redis` crate is available if pooling is needed for blocking commands.
- **MongoDB:** `mongodb` official Rust driver (v3.x requires tokio exclusively). `Client` has internal connection pooling (default max 10 connections). Implement `get_sidebar_items` by listing collection names via `list_collection_names`.
- **CockroachDB:** Re-uses the `PostgresDriver` with `DriverType::CockroachDB` flag to suppress unsupported DDL features (e.g., `CLUSTER BY`, advisory lock functions).
- **ClickHouse:** `clickhouse-rs` or the official `clickhouse` Rust client. Uses HTTP transport — no TCP pool needed. Schema introspection via `system.tables` and `system.columns`.

---

## 2. Monaco Editor Language Service Architecture

### Current State

The `SQLEditor.tsx` sets `defaultLanguage="sql"` with no completion provider. This gives generic keyword highlighting and nothing more.

### Recommended Pattern: Dialect-Scoped Language Services

Use `monaco-sql-languages` (by DTStack) as the foundation. It provides pre-built parsers and completion scaffolding for PostgreSQL, MySQL, Flink, Spark, Hive, Trino, and Impala — saving months of ANTLR/parser work.

**Confidence:** HIGH — library is actively maintained, used in production at Alibaba Cloud and similar, npm downloads trending up in 2025.

```typescript
// src/services/LanguageServiceManager.ts

import { setupLanguageFeatures, LanguageIdEnum } from 'monaco-sql-languages';
import type * as Monaco from 'monaco-editor';

export type SqlDialect = 'postgresql' | 'mysql' | 'sqlite' | 'generic';

export interface SchemaSnapshot {
  databases: string[];
  tables: Array<{ name: string; schema?: string }>;
  columns: Record<string, Array<{ name: string; type: string }>>;
}

export class LanguageServiceManager {
  private schemaCache = new Map<string, SchemaSnapshot>(); // keyed by connectionId
  private activeConnectionId: string | null = null;

  constructor(private monaco: typeof Monaco) {}

  /**
   * Call once at app startup to wire completion into Monaco.
   * The CompletionService callback closes over the cache, so it always
   * has access to the latest schema without re-registering.
   */
  initialize(): void {
    setupLanguageFeatures({
      completionService: async (model, position, suggestions, entities) => {
        const schema = this.activeConnectionId
          ? this.schemaCache.get(this.activeConnectionId)
          : null;

        const items: Monaco.languages.CompletionItem[] = [];

        // 1. Always include keyword suggestions from the parser
        items.push(...suggestions.keywords.map(k => ({
          label: k,
          kind: this.monaco.languages.CompletionItemKind.Keyword,
          insertText: k,
        })));

        if (schema) {
          // 2. Schema-aware table completions
          items.push(...schema.tables.map(t => ({
            label: t.name,
            kind: this.monaco.languages.CompletionItemKind.Class,
            detail: t.schema ? `schema: ${t.schema}` : 'table',
            insertText: t.name,
          })));

          // 3. Column completions when table context is parsed from AST
          if (entities?.length) {
            for (const entity of entities) {
              const cols = schema.columns[entity.value] ?? [];
              items.push(...cols.map(c => ({
                label: c.name,
                kind: this.monaco.languages.CompletionItemKind.Field,
                detail: c.type,
                insertText: c.name,
              })));
            }
          }
        }

        return items;
      }
    });
  }

  /** Called when the user switches connections or databases */
  updateActiveConnection(connectionId: string): void {
    this.activeConnectionId = connectionId;
  }

  /** Called after schema fetch succeeds */
  updateSchema(connectionId: string, snapshot: SchemaSnapshot): void {
    this.schemaCache.set(connectionId, snapshot);
  }

  /**
   * Returns the Monaco language ID for a given driver type.
   * The editor `language` prop is set at tab creation time.
   */
  getLanguageId(driverType: DriverType): string {
    const map: Record<string, string> = {
      Postgres: LanguageIdEnum.PG,
      CockroachDB: LanguageIdEnum.PG,
      MySQL: LanguageIdEnum.MYSQL,
      MariaDB: LanguageIdEnum.MYSQL,
      SQLite: 'sql',           // monaco-sql-languages has no SQLite dialect — use generic
      ClickHouse: 'sql',       // fallback until dialect is added
      MongoDB: 'json',         // Mongo query editor uses JSON/BSON mode
      Redis: 'plaintext',      // Redis CLI mode
    };
    return map[driverType] ?? 'sql';
  }
}
```

**Schema fetch trigger:** After connecting or switching databases, invoke `get_schema_snapshot` from Rust (which returns table names + column metadata), then call `languageServiceManager.updateSchema(...)`. Cache aggressively — refresh on explicit user trigger or DDL execution.

**Instance per editor or singleton?** Singleton with shared `schemaCache` per connection. Multiple editor instances in multiple tabs share the same schema data. Monaco's `registerCompletionItemProvider` is global — do not register multiple times.

---

## 3. State Management Architecture for Multi-Tab, Multi-Connection

### Current Problem

The single `useDatabaseStore` has 40+ fields mixing UI state, domain state, and persistence concerns. With 163 features added, this becomes untestable and a source of cross-concern coupling bugs.

### Recommended Pattern: Domain-Split Zustand Stores

Split into **5 independent domain stores** + **1 UI state store**. Components compose from multiple stores. Orchestration of cross-store actions happens at the component level or in a dedicated coordinator hook.

```typescript
// Store 1: Connections
// src/store/connectionStore.ts
// - savedConnections: SavedConnection[]
// - openConnectionIds: string[]
// - activeConnectionId: string | null
// - connect(), disconnect(), addConnection(), updateConnection(), removeConnection()
// Persistence: tauri-plugin-store → 'connections.json'

// Store 2: Workspaces / Tabs
// src/store/workspaceStore.ts
// - tabs: Tab[]
// - activeTabIds: Record<connectionId, tabId>
// - openTab(), closeTab(), setActiveTab(), updateTab()
// - Per-tab state: filters, sort, pagination, hiddenColumns, viewMode
// No persistence (tabs are session-only by default — power users may want restore)

// Store 3: Schema Cache
// src/store/schemaStore.ts
// - schemas: Record<connectionId, SchemaSnapshot>
// - sidebarItems: Record<connectionId, SidebarItem[]>
// - fetchSchema(connectionId), refreshSidebarItems(connectionId)
// Drives: autocomplete, sidebar, structure editor

// Store 4: Query History
// src/store/historyStore.ts
// - queryHistory: HistoryItem[]  (max 500, trimmed automatically)
// - consoleLog: ConsoleEntry[]   (rotating buffer, max 200 per connection)
// - addToHistory(), clearHistory()
// Persistence: tauri-plugin-store → 'history.json'

// Store 5: Settings / Preferences
// src/store/settingsStore.ts
// - theme: 'dark' | 'light' | 'system'
// - safeMode: 'Silent' | 'Alert' | 'Safe'
// - fontSize, fontFamily, editorLineNumbers
// - defaultPageSize, defaultExportFormat
// - keyboardShortcuts: Record<actionId, string>
// Persistence: tauri-plugin-store → 'settings.json'

// Store 6: UI State (ephemeral, no persistence)
// src/store/uiStore.ts
// - showConnectionModal, showCommandPalette, showDatabaseSelector
// - activePanels: { sidebar, right, console }
// - notifications: Notification[]
```

**Cross-store coordination example:**

```typescript
// src/hooks/useConnectionActions.ts
// When a user connects, coordinate across stores:
async function handleConnect(conn: SavedConnection, password?: string) {
  await connectionStore.connect(conn, password);           // opens Rust pool
  await schemaStore.fetchSchema(conn.id);                 // loads tables/columns
  languageServiceManager.updateActiveConnection(conn.id); // wires autocomplete
  uiStore.closeConnectionModal();
}
```

### Per-Connection Tab Isolation

The `tabs` array in `workspaceStore` is flat but scoped by `connectionId`. Active tab per connection is stored in `activeTabIds: Record<connectionId, tabId>`. When switching connections, the globally visible `activeTabId` is simply `activeTabIds[activeConnectionId]` — derived, not stored separately.

```typescript
// Derived selector — never stored as duplicated state
const visibleActiveTabId = useWorkspaceStore(state =>
  state.activeTabIds[activeConnectionId ?? ''] ?? null
);
```

---

## 4. Command Palette / "Open Anything" Architecture

### Recommended Pattern: `cmdk` + Frecency Ranking

Use `cmdk` (the library behind Linear, Raycast, Vercel). It is headless, handles fuzzy matching, keyboard navigation, and accessibility (aria, focus management). shadcn/ui's `Command` component is built on top of it and matches the existing Tailwind CSS stack.

**Confidence:** HIGH — cmdk powers major production apps, MIT licensed, zero-dependency core.

```typescript
// src/components/CommandPalette.tsx

import { Command } from 'cmdk';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  category: 'connection' | 'table' | 'action' | 'history';
  action: () => void;
}

// The palette is a single modal that aggregates items from all stores:
function buildCommandItems(
  connections: SavedConnection[],
  sidebarItems: SidebarItem[],
  queryHistory: HistoryItem[],
  activeConnectionId: string | null,
): CommandItem[] {
  return [
    // "Switch to connection X"
    ...connections.map(c => ({
      id: `conn:${c.id}`,
      label: c.name,
      category: 'connection' as const,
      description: `${c.type} · ${c.host ?? c.database}`,
      action: () => connectionStore.setActiveConnection(c.id),
    })),
    // "Open table X"
    ...sidebarItems.filter(i => i.item_type === 'Table').map(t => ({
      id: `table:${t.name}`,
      label: t.name,
      category: 'table' as const,
      description: activeConnectionId ?? '',
      action: () => workspaceStore.openTab({ type: 'table', tableName: t.name, ... }),
    })),
    // Actions
    { id: 'action:new-query', label: 'New Query Tab', category: 'action', action: () => ... },
    { id: 'action:import',    label: 'Import CSV...', category: 'action', action: () => ... },
    { id: 'action:backup',    label: 'Backup Database...', category: 'action', action: () => ... },
    // Recent history
    ...queryHistory.slice(0, 10).map(h => ({
      id: `history:${h.id}`,
      label: h.sql.slice(0, 60),
      category: 'history' as const,
      action: () => workspaceStore.openQueryTabWithSql(h.sql),
    })),
  ];
}
```

**Keyboard trigger:** `Cmd+K` / `Ctrl+K` — handled via `useEffect` on `keydown` at the `App.tsx` root level, setting `uiStore.showCommandPalette = true`.

**Performance note:** cmdk handles up to ~3,000 items without degradation. Beyond that, filter on the fly before rendering using a `useMemo` with debounced query input.

---

## 5. Backup/Restore Architecture (Subprocess Spawning)

### Pattern: Tauri Shell Plugin + Streaming Events

Do NOT buffer the entire dump in memory. Use `tauri-plugin-shell` with `.spawn()` (not `.output()`) to stream `stdout` and emit `tauri::window::emit` events as chunks arrive. This supports multi-GB dumps without OOM.

**Confidence:** HIGH — confirmed pattern from Tauri v2 official shell plugin docs.

```rust
// src-tauri/src/backup/mod.rs

use tauri_plugin_shell::ShellExt;
use tauri::Emitter;

#[tauri::command]
pub async fn backup_database(
    app: tauri::AppHandle,
    connection_id: Uuid,
    output_path: String,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let config = state.driver_registry.get_config(&connection_id).await
        .map_err(|e| e.to_string())?;

    // Build args specific to driver type
    let (cmd, args) = build_backup_command(&config, &output_path)?;

    let shell = app.shell();
    let (mut rx, _child) = shell.command(&cmd)
        .args(&args)
        .spawn()
        .map_err(|e| e.to_string())?;

    // Stream events back to frontend
    tauri::async_runtime::spawn(async move {
        let mut bytes_written: u64 = 0;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(chunk) => {
                    bytes_written += chunk.len() as u64;
                    let _ = app.emit("backup:progress", serde_json::json!({
                        "connection_id": connection_id,
                        "bytes_written": bytes_written,
                    }));
                    // Write chunk to file
                }
                CommandEvent::Stderr(err) => {
                    let _ = app.emit("backup:log", String::from_utf8_lossy(&err).to_string());
                }
                CommandEvent::Error(e) => {
                    let _ = app.emit("backup:error", e);
                    return;
                }
                CommandEvent::Terminated(status) => {
                    let _ = app.emit("backup:complete", serde_json::json!({
                        "success": status.code.map(|c| c == 0).unwrap_or(false),
                        "bytes_written": bytes_written,
                    }));
                    return;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn build_backup_command(config: &ConnectionConfig, output: &str) -> Result<(String, Vec<String>), String> {
    match config.driver_type {
        DriverType::Postgres | DriverType::CockroachDB => Ok((
            "pg_dump".to_string(),
            vec![
                format!("--host={}", config.host.as_deref().unwrap_or("localhost")),
                format!("--port={}", config.port.unwrap_or(5432)),
                format!("--username={}", config.username.as_deref().unwrap_or("postgres")),
                format!("--dbname={}", config.database.as_deref().unwrap_or("")),
                format!("--file={}", output),
                "--format=plain".to_string(),
            ],
        )),
        DriverType::MySQL | DriverType::MariaDB => Ok((
            "mysqldump".to_string(),
            vec![
                format!("--host={}", config.host.as_deref().unwrap_or("localhost")),
                format!("--port={}", config.port.unwrap_or(3306)),
                format!("--user={}", config.username.as_deref().unwrap_or("root")),
                config.database.clone().unwrap_or_default(),
                format!("--result-file={}", output),
            ],
        )),
        DriverType::SQLite => Ok((
            "sqlite3".to_string(),
            vec![
                config.database.clone().unwrap_or_default(),
                ".dump".to_string(),
            ],
        )),
        _ => Err(format!("Backup not supported for {:?}", config.driver_type)),
    }
}
```

**Capabilities config** (`src-tauri/capabilities/default.json`) must explicitly allowlist each external binary by name:

```json
{
  "permissions": [
    {
      "identifier": "shell:allow-spawn",
      "allow": [
        { "name": "pg_dump",    "cmd": "pg_dump",    "args": true, "sidecar": false },
        { "name": "pg_restore", "cmd": "pg_restore", "args": true, "sidecar": false },
        { "name": "mysqldump",  "cmd": "mysqldump",  "args": true, "sidecar": false },
        { "name": "mysql",      "cmd": "mysql",      "args": true, "sidecar": false },
        { "name": "sqlite3",    "cmd": "sqlite3",    "args": true, "sidecar": false }
      ]
    }
  ]
}
```

**Critical:** pg_dump writes the database name to `PGPASSWORD` env var risk — use `PGPASSFILE` or `PGPASSWORD` via `.env()` on the `Command` builder to avoid shell injection.

---

## 6. Settings / Preferences Architecture

### Pattern: tauri-plugin-store with Typed Wrappers

Use the official Tauri store plugin. Organize settings into **separate JSON files** by domain — this allows loading only what is needed at startup.

```typescript
// src/services/SettingsService.ts

import { load, Store } from '@tauri-apps/plugin-store';

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  fontFamily: string;
  safeMode: 'Silent' | 'Alert' | 'Safe';
  defaultPageSize: number;
  showLineNumbers: boolean;
  wordWrap: boolean;
  defaultExportFormat: 'csv' | 'json' | 'sql';
}

const DEFAULTS: AppSettings = {
  theme: 'dark',
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  safeMode: 'Silent',
  defaultPageSize: 100,
  showLineNumbers: true,
  wordWrap: true,
  defaultExportFormat: 'csv',
};

class SettingsService {
  private store: Store | null = null;

  async init(): Promise<void> {
    this.store = await load('settings.json', { autoSave: true });
  }

  async get<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
    const val = await this.store!.get<AppSettings[K]>(key);
    return val ?? DEFAULTS[key];
  }

  async set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    await this.store!.set(key, value);
    // Emit to Zustand settingsStore so UI re-renders
    useSettingsStore.getState().update(key, value);
  }

  async getAll(): Promise<AppSettings> {
    const result: Partial<AppSettings> = {};
    for (const key of Object.keys(DEFAULTS) as Array<keyof AppSettings>) {
      result[key] = await this.get(key) as any;
    }
    return result as AppSettings;
  }
}

export const settingsService = new SettingsService();
```

**File organization:**

| File | Contents |
|------|----------|
| `settings.json` | UI preferences (theme, fonts, behavior) |
| `connections.json` | Saved connection configs (no passwords) |
| `history.json` | Query history (last 500 entries) |
| `shortcuts.json` | Custom keyboard shortcut overrides |

**Sensitive data (passwords):** Never in JSON. Use the existing `keyring` crate (already in Cargo.toml) via `keyring::Entry::new("sqlmate", &connection_id.to_string())`. This stores in OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service).

---

## 7. Metrics Dashboard Architecture

### Recommended Pattern: Polling + Recharts

For database metrics (active connections, query throughput, table sizes, cache hit ratio), use a **polling model** rather than real-time push, since databases do not push metrics — they must be queried.

**Chart library:** Recharts. Reasons: SVG rendering (crisp at all DPIs), idiomatic JSX API, smallest bundle of the major options (~200KB), wraps D3 without forcing D3 usage, strong Tailwind CSS integration. Nivo is heavier and better suited for embedded BI — overkill for a tool like sqlMate.

**Confidence:** MEDIUM (library choice is opinionated; both Recharts and Nivo are viable)

```typescript
// src/hooks/useMetricsPoller.ts

import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function useMetricsPoller(
  connectionId: string | null,
  interval: number = 5000,
) {
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!connectionId) return;

    const poll = async () => {
      try {
        const metrics = await invoke<DatabaseMetrics>('get_database_metrics', { connectionId });
        useMetricsStore.getState().updateMetrics(connectionId, metrics);
      } catch {
        // Silent — don't crash if metrics query fails
      }
    };

    poll();
    timer.current = window.setInterval(poll, interval);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [connectionId, interval]);
}
```

```rust
// Metrics command — queries database system tables
#[tauri::command]
pub async fn get_database_metrics(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<serde_json::Value, String> {
    state.driver_registry
        .with_driver(&connection_id, |driver| {
            // Each driver impl queries its own system views:
            // Postgres: pg_stat_activity, pg_stat_user_tables, pg_statio_user_tables
            // MySQL: information_schema.PROCESSLIST, performance_schema.table_io_waits_summary
            // etc.
            driver.get_metrics()
        })
        .await
        .map_err(|e| e.to_string())
}
```

**MetricsStore** (6th separate Zustand store):

```typescript
// src/store/metricsStore.ts
// - timeSeries: Record<connectionId, MetricPoint[]>  (ring buffer, max 60 points per metric)
// - updateMetrics(connectionId, metrics)
// - clearMetrics(connectionId)
// No persistence — all in-memory, session-only
```

**Chart component pattern:**

```tsx
// src/components/metrics/ActiveConnectionsChart.tsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export function ActiveConnectionsChart({ connectionId }: { connectionId: string }) {
  const data = useMetricsStore(s => s.timeSeries[connectionId]?.activeConnections ?? []);
  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={data}>
        <XAxis dataKey="timestamp" tickFormatter={t => new Date(t).toLocaleTimeString()} />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey="value" stroke="#3b82f6" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

---

## 8. Console Log / Query Recording Architecture

### Pattern: Ring Buffer in Zustand + Structured Entries

TablePlus's console log and DBeaver's Query Manager both follow the same conceptual pattern: an append-only log with structured entries per query execution. The key design difference is whether the log is stored in a local database (DBeaver uses H2) or in-memory with optional file persistence.

**Recommendation:** In-memory ring buffer in `historyStore`, with optional file export. No embedded database for the console log — the complexity cost is not justified for a desktop client.

```typescript
// src/store/historyStore.ts

export interface ConsoleEntry {
  id: string;
  connectionId: string;
  database: string | null;
  sql: string;
  status: 'running' | 'success' | 'error' | 'cancelled';
  executionTimeMs: number | null;
  rowsAffected: number | null;
  error: string | null;
  timestamp: number;
}

// Ring buffer: max 200 entries per connection, evict oldest when full
const MAX_CONSOLE_ENTRIES = 200;

interface HistoryState {
  queryHistory: HistoryItem[];       // persistent (tauri-plugin-store)
  consoleLog: ConsoleEntry[];        // session-only ring buffer

  addConsoleEntry: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => string;
  updateConsoleEntry: (id: string, updates: Partial<ConsoleEntry>) => void;
  clearConsoleLog: (connectionId?: string) => void;
}
```

**Lifecycle:** When a query starts, `addConsoleEntry(...)` with `status: 'running'` and captures the returned `id`. When the streaming `query-complete` Tauri event fires, call `updateConsoleEntry(id, { status: 'success', executionTimeMs, rowsAffected })`. This gives the console live status updates without polling.

**Console panel component** renders from `historyStore.consoleLog` filtered to the active connection, using `react-window` (already in the project) for virtualized rendering of large logs.

---

## 9. Table Structure Editor Architecture

### Pattern: Optimistic DDL Generation

The structure editor must never apply changes immediately. All edits produce a pending DDL diff that the user reviews before applying. This is the pattern used by TablePlus's "Change" view and DataGrip's pending changes.

```typescript
// src/store/structureEditorStore.ts (or within workspaceStore per tab)

export interface ColumnEdit {
  originalName: string | null;  // null = new column
  name: string;
  type: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  operation: 'add' | 'modify' | 'drop' | 'rename' | 'none';
}

export interface PendingStructureChange {
  tableName: string;
  connectionId: string;
  columnEdits: ColumnEdit[];
  indexEdits: IndexEdit[];
  constraintEdits: ConstraintEdit[];
  generatedSQL: string | null;  // populated by Rust DDL generator
}
```

The **DDL generator lives in Rust** (in each driver's impl), not the frontend. The frontend sends the `PendingStructureChange` to:

```rust
#[tauri::command]
pub async fn preview_structure_change(
    state: State<'_, AppState>,
    connection_id: Uuid,
    change: PendingStructureChange,
) -> Result<Vec<String>, String> {
    // Returns a Vec<String> of SQL statements (ALTER TABLE, etc.)
    // Driver generates dialect-correct DDL
    state.driver_registry
        .with_driver(&connection_id, |d| d.generate_ddl(&change))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn apply_structure_change(
    state: State<'_, AppState>,
    connection_id: Uuid,
    statements: Vec<String>,
) -> Result<(), String> {
    // Executes the approved statements in a transaction where supported
}
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Growing the `ConnectionManager` with More Type Fields
**What:** Adding `redis_pools`, `mongo_clients`, etc. as new `HashMap` fields in `ConnectionManager`.
**Why bad:** Each new engine requires modifying every command handler. At 14 engines, the struct becomes 14+ fields and every function has 14+ match arms.
**Instead:** The `DriverRegistry` with enum dispatch described above.

### Anti-Pattern 2: sqlx AnyPool for Multi-Engine Abstraction
**What:** Using `sqlx::AnyPool` to run all queries through a single type-erased pool.
**Why bad:** Loses all compile-time query checking. Limited to the 4 engines sqlx supports. Cannot handle Redis, MongoDB, Elasticsearch.
**Instead:** Per-engine driver modules behind the `DatabaseDriver` trait.

### Anti-Pattern 3: One Monolithic Zustand Store
**What:** Continuing to add every new feature's state to `databaseStore.ts`.
**Why bad:** Every subscriber re-renders on every state change. Impossible to test individual domains. Merge conflicts across parallel feature branches.
**Instead:** 6 domain-split stores as described above.

### Anti-Pattern 4: Monaco Registered Globally with Database-Specific State Inside
**What:** Registering a single completion provider that mutates global state variables to know the current schema.
**Why bad:** Multiple editor instances in different tabs interfere with each other. Race conditions when switching connections rapidly.
**Instead:** The `LanguageServiceManager` singleton with the `schemaCache` map described above. The completion callback reads from the map; it never mutates Monaco's global language registry after initialization.

### Anti-Pattern 5: `pg_dump` Password via Shell String Interpolation
**What:** Building the `pg_dump` command string with the password embedded.
**Why bad:** Password exposed in process list (`ps aux`) and shell history. Security violation.
**Instead:** Pass via `PGPASSWORD` environment variable on the `Command` builder, or write a `.pgpass` temporary file and reference it via `PGPASSFILE`.

### Anti-Pattern 6: DDL Generation in Frontend TypeScript
**What:** Having the React frontend construct `ALTER TABLE` SQL strings.
**Why bad:** Each database has different ALTER TABLE syntax, quoting rules, and constraint naming. Generating correct DDL for 14 engines in TypeScript is a maintenance nightmare and a correctness risk.
**Instead:** DDL generation in the Rust driver layer, validated against the actual engine, returned to the frontend for display and confirmation only.

---

## Scalability Considerations

| Concern | Current (3 engines) | At 14 engines | At 14 engines + features |
|---------|---------------------|---------------|--------------------------|
| Adding a new engine | Modify 4+ functions | Add 1 driver module | Add 1 driver module (pattern holds) |
| Query execution path | `match db_type { 3 arms }` | `driver_registry.with_driver()` | Same |
| Frontend state | 1 store, 40+ fields | 6 stores, ~10 fields each | Add a 7th store for new domain |
| Autocomplete | None | 1 LanguageServiceManager | Same, add dialect mapping |
| Metrics | None | MetricsStore + poller hook | Add metric types to driver trait |
| Settings | localStorage only | tauri-plugin-store + SettingsService | Add keys to AppSettings interface |

---

## Migration Path from Current Code

The recommended migration sequence (least disruption, most parallelizable):

1. **Extract DriverRegistry** from `ConnectionManager`. Keep `ConnectionManager` as a compatibility shim initially. New engines go into `DriverRegistry` from the start.
2. **Split Zustand store** into 6 stores. Begin with extracting `historyStore` and `settingsStore` (lowest coupling) before tackling `workspaceStore`.
3. **Add `LanguageServiceManager`** as an additive change — the existing `SQLEditor.tsx` keeps working, the new manager layer is mounted at `App.tsx` root.
4. **Add `tauri-plugin-store`** for settings persistence before migrating connection storage off `localStorage`.
5. **Add `tauri-plugin-shell`** for backup/restore as a new command set — no existing commands change.
6. **Add `cmdk`** as a new UI component triggered by `Cmd+K` — purely additive, no existing code changes.

---

## Sources

- [sqlx Database trait docs — not dyn compatible](https://docs.rs/sqlx/latest/sqlx/trait.Database.html)
- [sqlx AnyPool documentation](https://docs.rs/sqlx/latest/sqlx/type.AnyPool.html)
- [enum_dispatch crate — up to 10x over dyn Trait](https://docs.rs/enum_dispatch/latest/enum_dispatch/)
- [async fn and RPITIT in traits — Rust Blog (Rust 1.75)](https://blog.rust-lang.org/2023/12/21/async-fn-rpit-in-traits/)
- [DTStack monaco-sql-languages — multi-dialect SQL for Monaco](https://github.com/DTStack/monaco-sql-languages/blob/main/README.md)
- [cmdk — headless command palette (powers Linear, Raycast)](https://github.com/dip/cmdk)
- [Tauri shell plugin — spawn, stream, sidecar](https://v2.tauri.app/plugin/shell/)
- [Tauri store plugin — JSON persistence](https://v2.tauri.app/plugin/store/)
- [redis-rs with tokio MultiplexedConnection](https://redis.io/docs/latest/develop/clients/rust/)
- [mongodb Rust driver — tokio-only since v3.0](https://www.mongodb.com/docs/drivers/rust/current/)
- [Zustand architecture patterns at scale](https://brainhub.eu/library/zustand-architecture-patterns-at-scale)
- [Recharts vs Nivo comparison for dashboards](https://www.speakeasy.com/blog/nivo-vs-recharts)
- [DBeaver Query Manager architecture](https://dbeaver.com/docs/dbeaver/Query-Manager/)
- [TablePlus Console Log pattern](https://docs.tableplus.com/gui-tools/the-interface/console-log)
- [Tauri shell allow-spawn capabilities config](https://v2.tauri.app/plugin/shell/)
- [Synaptic Engineering — Multi-tab app migration to Zustand](https://engineering.synaptic.com/managing-state-in-a-multi-tabbed-application-our-journey-from-redux-to-zustand-6d3932544300)
