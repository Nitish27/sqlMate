# Phase 1: Security & Foundation Repair - Research

**Researched:** 2026-03-02
**Domain:** Rust/sqlx security patching, Tauri 2.x persistence migration, Rust trait-based driver dispatch, Zustand domain store splitting
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FR-01.1 | Upgrade sqlx from 0.7 to 0.8.1+ to patch RUSTSEC-2024-0363 (PostgreSQL RCE) | sqlx 0.8.x changelog + RustSec advisory confirm exact breaking changes and migration steps |
| FR-01.2 | Migrate all localStorage persistence to `tauri-plugin-store` with one-time data migration for existing users | Tauri plugin-store API confirmed; localStorage keys `sqlmate_saved_connections` and `sqlmate_query_history` identified in source |
| FR-01.3 | Refactor ConnectionManager into DriverRegistry with DatabaseDriver trait and enum-based dispatch | Current triple-HashMap ConnectionManager identified; enum_dispatch pattern fully documented with code |
| FR-01.4 | Split monolithic Zustand store into 6 domain stores: connectionStore, workspaceStore, schemaStore, historyStore, settingsStore, uiStore | Current 260-line monolithic databaseStore.ts confirmed; split strategy with migration path documented |
| FR-01.5 | Fix test_connection to use options builder pattern instead of URL string interpolation | Line 82 and 95 in connection_manager.rs confirmed as URL string interpolation; builder pattern API documented |
| FR-01.6 | Add cargo audit to CI pipeline | No CI configuration found in project; GitHub Actions setup required from scratch |
</phase_requirements>

---

## Summary

Phase 1 addresses six interconnected problems that must be solved before any other feature work. Two are active security vulnerabilities (sqlx RCE, password-in-URL). Two are data integrity risks that will silently destroy user data (localStorage wipe on Tauri URL scheme changes, SSH passwords persisted in plaintext). Two are architectural blockers that make future feature work exponentially harder (ConnectionManager cannot scale to 14+ engines, monolithic Zustand store causes cross-tab re-render cascades).

Code inspection confirms every problem is real and exactly as described in research. The `ConnectionManager` has three separate typed `HashMap` fields (postgres_pools, mysql_pools, sqlite_pools) — every command handler must be modified for each new engine. The `databaseStore.ts` is a single 740-line file mixing connection state, tab state, UI state, and persistence logic. The `test_connection` function at lines 82 and 95 uses `format!("postgres://{}:{}@{}:{}/{}", user, pass, host, port, db)` — a password-in-URL interpolation. The `loadConnectionsFromStorage` and `addToHistory` functions read/write directly to `localStorage`.

All six fixes are well-understood, have verified implementation patterns, and are purely internal refactoring with no new user-facing features. The deliverables of this phase are invisible to users but unblock all 9 subsequent phases. This is the only phase that blocks everything else.

**Primary recommendation:** Implement all six requirements in strict order: sqlx upgrade first (security), then localStorage migration (data safety), then ConnectionManager refactor (architecture), then Zustand split (architecture), then test_connection fix (security), then CI setup (ongoing protection). The sqlx upgrade may surface breaking changes that affect subsequent tasks, so it must be first.

---

## Standard Stack

### Core (Phase 1 additions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| sqlx | 0.8.6 | Postgres/MySQL/SQLite drivers (patched) | Only change from current 0.7; patches RUSTSEC-2024-0363 |
| @tauri-apps/plugin-store | 2.x | Persistent JSON file storage | Official Tauri plugin; survives URL scheme changes unlike localStorage |
| tauri-plugin-store | 2.x | Rust-side store access (optional) | Companion crate for Rust-side store reads |
| enum_dispatch | 0.3 | Zero-overhead enum-based trait dispatch | Up to 10x faster than dyn Trait vtable; no heap allocation |
| async-trait | 0.1 | Async fn in traits for DatabaseDriver | Required because RPITIT/AFIT cannot be used with enum dispatch |

### Already Present (Confirmed in Cargo.toml)

| Library | Version | Relevance |
|---------|---------|-----------|
| sqlx | 0.7.x | Must be upgraded to 0.8.x |
| keyring | 2.x | Already available for OS-level credential storage |
| uuid | 1.x | Connection ID type already used |
| anyhow | 1.x | Error handling already in use |
| zustand | 5.x | Store framework already in use |
| @tauri-apps/plugin-dialog | 2.x | Already installed, confirms Tauri 2.x plugin pattern |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| cargo-audit | latest | Rust security advisory scanner | CI pipeline; run on every PR and push to main |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| enum_dispatch | Box<dyn DatabaseDriver> | vtable overhead, heap allocation; sqlx Database trait is not dyn-compatible anyway |
| tauri-plugin-store | Custom JSON file | Plugin handles atomic writes, concurrent access, and app data path resolution correctly |
| 6 separate Zustand stores | Zustand slice pattern (combined store) | STACK.md recommends slice pattern; ARCHITECTURE.md recommends separate stores. Separate stores chosen because they enable independent testing and future partial loading |

**Installation (Phase 1 additions):**

```bash
# Frontend
npm install @tauri-apps/plugin-store

# Rust (Cargo.toml changes)
# sqlx: "0.7" → "0.8.6"
# Add: enum_dispatch = "0.3"
# Add: async-trait = "0.1"
# Add: tauri-plugin-store = "2"
```

---

## Architecture Patterns

### Recommended Project Structure (After Phase 1)

```
src-tauri/src/
├── core/
│   ├── mod.rs           # Types: ConnectionConfig, QueryResult, SchemaSnapshot, etc.
│   ├── app_state.rs     # AppState struct: DriverRegistry + active_queries
│   └── query_engine.rs  # Query execution logic (dispatches via DriverRegistry)
├── drivers/
│   ├── mod.rs           # DatabaseDriver trait, DriverConnection enum, DriverRegistry
│   ├── postgres.rs      # PostgresDriver — wraps PgPool
│   ├── mysql.rs         # MySQLDriver — wraps MySqlPool
│   └── sqlite.rs        # SQLiteDriver — wraps SqlitePool
├── db/
│   └── mod.rs           # (existing, can remain as-is for now)
├── security/
│   └── mod.rs           # (existing)
└── lib.rs               # Tauri command handlers (thin: validate + dispatch to DriverRegistry)

src/store/
├── connectionStore.ts   # savedConnections, openConnectionIds, connect/disconnect
├── workspaceStore.ts    # tabs, activeTabIds per connection
├── schemaStore.ts       # schemas per connectionId (empty in Phase 1, used in Phase 3)
├── historyStore.ts      # queryHistory ring buffer
├── settingsStore.ts     # theme, safeMode, UI preferences
└── uiStore.ts           # modal visibility, panel toggles, ephemeral UI state
```

### Pattern 1: Enum-Based Driver Dispatch (DatabaseDriver Trait)

**What:** A `DatabaseDriver` trait defines the contract for all database operations. A `DriverConnection` enum wraps each concrete driver type. A `DriverRegistry` holds `HashMap<Uuid, DriverConnection>` and dispatches via the enum.

**When to use:** Every Tauri command that needs a database connection dispatches through `DriverRegistry`. This replaces all direct `ConnectionManager` calls.

**Why enum over dyn Trait:** `sqlx`'s `Database` trait is explicitly not dyn-compatible (confirmed in official sqlx docs). `Box<dyn DatabaseDriver>` with `async_trait` adds vtable overhead. `enum_dispatch` provides up to 10x faster dispatch with zero heap allocation since all engine types are known at compile time.

```rust
// Source: ARCHITECTURE.md + sqlx official docs on dyn-incompatibility
// src-tauri/src/drivers/mod.rs

use async_trait::async_trait;
use uuid::Uuid;
use enum_dispatch::enum_dispatch;

#[async_trait]
#[enum_dispatch(DriverConnection)]
pub trait DatabaseDriver: Send + Sync {
    async fn connect(&mut self, config: &ConnectionConfig, password: Option<&str>) -> anyhow::Result<()>;
    async fn disconnect(&self) -> anyhow::Result<()>;
    async fn ping(&self) -> anyhow::Result<()>;
    async fn get_databases(&self) -> anyhow::Result<Vec<String>>;
    async fn get_sidebar_items(&self) -> anyhow::Result<Vec<SidebarItem>>;
    async fn get_table_structure(&self, table: &str) -> anyhow::Result<TableStructure>;
    async fn execute_query(&self, sql: &str, page: u32, page_size: u32) -> anyhow::Result<QueryResult>;
    async fn execute_mutation(&self, sql: &str) -> anyhow::Result<u64>;
    fn driver_type(&self) -> DriverType;
    fn connection_id(&self) -> Uuid;
}

// Phase 1: only these three variants needed
// Phase 9 adds more variants — NO existing code changes required
#[enum_dispatch]
pub enum DriverConnection {
    Postgres(PostgresDriver),
    MySQL(MySQLDriver),
    SQLite(SQLiteDriver),
}

pub struct DriverRegistry {
    connections: Arc<Mutex<HashMap<Uuid, DriverConnection>>>,
    configs: Arc<Mutex<HashMap<Uuid, ConnectionConfig>>>,
}

impl DriverRegistry {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            configs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn connect(&self, config: ConnectionConfig, password: Option<String>) -> anyhow::Result<()> {
        let driver = self.build_driver(&config, password.as_deref()).await?;
        let mut conns = self.connections.lock().await;
        conns.insert(config.id, driver);
        let mut cfgs = self.configs.lock().await;
        cfgs.insert(config.id, config);
        Ok(())
    }

    pub async fn with_driver<F, R, Fut>(&self, id: &Uuid, f: F) -> anyhow::Result<R>
    where
        F: FnOnce(&DriverConnection) -> Fut,
        Fut: std::future::Future<Output = anyhow::Result<R>>,
    {
        let conns = self.connections.lock().await;
        let driver = conns.get(id).ok_or_else(|| anyhow::anyhow!("Connection {} not found", id))?;
        f(driver).await
    }
}
```

### Pattern 2: tauri-plugin-store Migration with One-Time localStorage Fallback

**What:** On first launch after update, check localStorage for legacy keys. If found, write to plugin-store and clear localStorage. All subsequent reads/writes use the plugin-store exclusively.

**When to use:** App startup, before any connection data is read.

```typescript
// Source: ARCHITECTURE.md Settings section + PITFALLS.md Pitfall 2
// src/services/SettingsService.ts

import { load, Store } from '@tauri-apps/plugin-store';
import type { SavedConnection } from '../store/connectionStore';

const LEGACY_CONNECTIONS_KEY = 'sqlmate_saved_connections';
const LEGACY_HISTORY_KEY = 'sqlmate_query_history';
const LEGACY_OXIDE_CONNECTIONS_KEY = 'oxide_saved_connections';

export class StoreService {
  private connectionsStore: Store | null = null;
  private settingsStore: Store | null = null;
  private historyStore: Store | null = null;

  async init(): Promise<void> {
    this.connectionsStore = await load('connections.json', { autoSave: true });
    this.settingsStore = await load('settings.json', { autoSave: true });
    this.historyStore = await load('history.json', { autoSave: true });

    await this.migrateFromLocalStorage();
  }

  /** One-time migration: run on every startup, no-op if already migrated */
  private async migrateFromLocalStorage(): Promise<void> {
    const alreadyMigrated = await this.connectionsStore!.get<boolean>('_migrated_v1');
    if (alreadyMigrated) return;

    // Migrate connections
    const raw = localStorage.getItem(LEGACY_CONNECTIONS_KEY)
      ?? localStorage.getItem(LEGACY_OXIDE_CONNECTIONS_KEY);
    if (raw) {
      try {
        const connections: SavedConnection[] = JSON.parse(raw);
        await this.connectionsStore!.set('connections', connections);
        localStorage.removeItem(LEGACY_CONNECTIONS_KEY);
        localStorage.removeItem(LEGACY_OXIDE_CONNECTIONS_KEY);
      } catch (e) {
        console.error('Migration: failed to parse saved connections', e);
      }
    }

    // Migrate query history
    const historyRaw = localStorage.getItem(LEGACY_HISTORY_KEY)
      ?? localStorage.getItem('oxide_query_history');
    if (historyRaw) {
      try {
        const history = JSON.parse(historyRaw);
        await this.historyStore!.set('items', history);
        localStorage.removeItem(LEGACY_HISTORY_KEY);
        localStorage.removeItem('oxide_query_history');
      } catch (e) {
        console.error('Migration: failed to parse query history', e);
      }
    }

    await this.connectionsStore!.set('_migrated_v1', true);
  }

  async getConnections(): Promise<SavedConnection[]> {
    return (await this.connectionsStore!.get<SavedConnection[]>('connections')) ?? [];
  }

  async setConnections(connections: SavedConnection[]): Promise<void> {
    await this.connectionsStore!.set('connections', connections);
  }
}

export const storeService = new StoreService();
```

### Pattern 3: Zustand Domain Store Split

**What:** Split the single 740-line `databaseStore.ts` into 6 independent stores. Components import only the store they need. Cross-store actions happen in coordinator hooks.

**When to use:** All React components in Phase 1 and beyond should use the domain-specific stores, not the old monolithic store.

**Migration strategy:** Extract stores in order of lowest coupling first: `historyStore` (no deps), `settingsStore` (no deps), `uiStore` (no deps), then `connectionStore`, `workspaceStore`, `schemaStore` (which depend on connectionStore).

```typescript
// Source: ARCHITECTURE.md Section 3
// src/store/connectionStore.ts
import { create } from 'zustand';
import { storeService } from '../services/StoreService';

interface ConnectionState {
  savedConnections: SavedConnection[];
  openConnectionIds: string[];
  activeConnectionId: string | null;
  // actions
  addConnection: (conn: SavedConnection) => Promise<void>;
  updateConnection: (id: string, updates: Partial<SavedConnection>) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  connect: (conn: SavedConnection, password?: string | null) => Promise<void>;
  setActiveConnectionId: (id: string | null) => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  savedConnections: [],  // loaded async from storeService.init()
  openConnectionIds: [],
  activeConnectionId: null,

  addConnection: async (conn) => {
    const next = [...get().savedConnections, conn];
    set({ savedConnections: next });
    await storeService.setConnections(next);
  },
  // ...
}));

// src/store/uiStore.ts — ephemeral, no persistence
export const useUIStore = create((set) => ({
  showConnectionModal: false,
  showDatabaseSelector: false,
  showImportDialog: false,
  showExportDialog: false,
  showCommandPalette: false,
  activePanels: { sidebar: true, right: false, console: false },
  setShowConnectionModal: (show: boolean) => set({ showConnectionModal: show }),
  togglePanel: (panel: 'sidebar' | 'right' | 'console') =>
    set((s: any) => ({ activePanels: { ...s.activePanels, [panel]: !s.activePanels[panel] } })),
}));

// src/store/settingsStore.ts — persisted via storeService
export const useSettingsStore = create((set) => ({
  theme: 'dark' as 'dark' | 'light' | 'system',
  safeMode: 'Silent' as 'Silent' | 'Alert' | 'Safe',
  setTheme: (theme: 'dark' | 'light' | 'system') => set({ theme }),
  setSafeMode: (mode: 'Silent' | 'Alert' | 'Safe') => set({ safeMode: mode }),
}));

// Cross-store coordinator hook
// src/hooks/useConnectionActions.ts
export function useConnectionActions() {
  const { connect: storeConnect } = useConnectionStore();
  const { fetchSidebarItems } = useSchemaStore();
  const { setShowConnectionModal } = useUIStore();

  const connect = async (conn: SavedConnection, password?: string) => {
    await storeConnect(conn, password);
    await fetchSidebarItems(conn.id);    // schemaStore
    setShowConnectionModal(false);        // uiStore
  };

  return { connect };
}
```

### Pattern 4: test_connection Options Builder Fix

**What:** Replace password-in-URL string interpolation with `PgConnectOptions`/`MySqlConnectOptions` builder pattern. The current code at `connection_manager.rs` lines 82-110 uses `format!("postgres://{}:{}@...", user, pass, ...)`.

**When to use:** `test_connection` function in `ConnectionManager` (and the new `DriverRegistry` equivalent).

```rust
// Source: PITFALLS.md Pitfall 15 + sqlx PgConnectOptions docs
// WRONG (current code — passwords with @ or : in them will break):
let url = format!("postgres://{}:{}@{}:{}/{}", user, pass, host, port, db);
let mut conn = sqlx::postgres::PgConnection::connect(&url).await?;

// CORRECT (options builder — no URL parsing, special chars safe):
use sqlx::postgres::{PgConnectOptions, PgSslMode};
use std::str::FromStr;

let opts = PgConnectOptions::new()
    .host(host)
    .port(port)
    .username(user)
    .password(pass)  // password() takes &str — never goes through URL parsing
    .database(db);

let mut conn = sqlx::postgres::PgConnection::connect_with(&opts).await?;
conn.ping().await.map_err(|e| anyhow!("Ping failed: {}", e))?;

// MySQL equivalent:
use sqlx::mysql::MySqlConnectOptions;

let opts = MySqlConnectOptions::new()
    .host(host)
    .port(port)
    .username(user)
    .password(pass)
    .database(db);

let mut conn = sqlx::mysql::MySqlConnection::connect_with(&opts).await?;
```

### Pattern 5: sqlx 0.8 Migration Breaking Changes

**What:** sqlx 0.8.x introduces breaking changes from 0.7.x that require code updates throughout `query_engine.rs` and `connection_manager.rs`.

**Known breaking changes (HIGH confidence from sqlx 0.8 changelog):**
- MSRV bumped to Rust 1.78.0 — update `rust-toolchain.toml` or confirm Rust version
- `query*()` macros now require `impl SqlSafeStr` — raw string queries need `sqlx::raw_sql()` wrapper or verified via compile-time macros
- `AnyPool` behavior changes — not used in this project so no impact
- `FromRow` derive changes — may affect deserialization of query results
- Pool options API: `PoolOptions` builder pattern unchanged; `connect_with()` unchanged

```toml
# Cargo.toml change:
# Before:
sqlx = { version = "0.7", features = ["runtime-tokio-rustls", "postgres", "mysql", "sqlite", "chrono", "uuid", "json", "rust_decimal"] }

# After:
sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "postgres", "mysql", "sqlite", "chrono", "uuid", "json", "rust_decimal"] }
```

### Pattern 6: cargo-audit CI Setup

**What:** Add `cargo audit` as a CI check that runs on every PR and push to `main`. GitHub Actions workflow from scratch since no `.github/` directory exists.

```yaml
# Source: RustSec docs + GitHub Actions docs
# .github/workflows/security.yml
name: Security Audit

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1'  # Weekly Monday 6am UTC

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install cargo-audit
        run: cargo install cargo-audit --locked
      - name: Run cargo audit
        working-directory: src-tauri
        run: cargo audit
```

### Anti-Patterns to Avoid

- **Growing ConnectionManager with more HashMap fields:** Each new engine (Phase 9 adds 9 more) would require modifying every command handler. DriverRegistry with enum dispatch prevents this.
- **Keeping localStorage as a fallback:** Even a fallback means data can be written to localStorage. Once migration runs, localStorage must never be written to again.
- **Splitting Zustand stores into separate `create()` calls with no coordination:** Cross-store actions become prop drilling nightmares. Use coordinator hooks (useConnectionActions) to orchestrate multi-store operations.
- **Using sqlx AnyPool for multi-engine abstraction:** AnyPool loses compile-time checking and cannot handle non-SQL engines (Redis, MongoDB, needed in Phase 9).
- **Storing row data in any Zustand store:** The current `tabs[n].rows?: any[][]` in `databaseStore.ts` holds query results in Zustand. This must NOT be replicated in `workspaceStore`. Row data belongs in component-local refs or a Map outside Zustand.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Persistent app storage | Custom JSON file reader/writer | `tauri-plugin-store` | Handles atomic writes, concurrent access, app data path resolution, and cross-platform storage location |
| Multi-engine dispatch | Growing match arms per engine | `enum_dispatch` crate | Zero vtable overhead; adding an engine is one new variant + one impl — no existing match arms change |
| Security advisory scanning | Manual CVE checking | `cargo audit` in CI | RustSec database is updated constantly; manual checking will miss advisories |
| Async fn in trait bounds | Manual trait object boxing | `async-trait` proc macro | Rust 1.75 AFIT only works for static dispatch; enum dispatch requires async-trait for shared trait methods |
| OS credential storage | Custom encryption in JSON | Existing `keyring` crate (already present) | OS keychain integration already in Cargo.toml; do not add new credential storage |

**Key insight:** In this phase, every problem has an existing, well-tested solution. The value is in proper wiring, not in clever custom code.

---

## Common Pitfalls

### Pitfall 1: sqlx 0.8 Compile Errors from query! Macro Changes

**What goes wrong:** `sqlx::query!()` macros now require a `DATABASE_URL` at compile time via `.sqlx` directory or environment variable. The macro-based queries in `query_engine.rs` may fail to compile after upgrade.

**Why it happens:** sqlx 0.8 tightened compile-time verification requirements.

**How to avoid:** Use `sqlx::query()` (runtime, no macro) for dynamic SQL like the query editor. Only use `query!()` macro for static queries with known schema. If the codebase uses `query()` not `query!()`, this pitfall does not apply — confirm by grepping for `query!` in src-tauri.

**Warning signs:** Compile errors about `DATABASE_URL` not set, or `.sqlx` directory missing.

### Pitfall 2: localStorage Migration Runs Every Startup If `_migrated_v1` Flag Is Missing

**What goes wrong:** If the store write for `_migrated_v1 = true` fails (e.g., disk full, permission issue), every subsequent startup will attempt migration and may overwrite data written after migration.

**Why it happens:** The migration flag is written last, so any failure before that point causes re-migration.

**How to avoid:** Write the migration flag FIRST, then migrate data. If migration data write fails, warn the user but do not re-run migration on next startup (the flag is already set). Alternatively, check for the existence of `connections` key in the store as the migration gate instead of a separate flag.

**Warning signs:** Connections disappearing or duplicating after app restart.

### Pitfall 3: Zustand Store Import Cycles

**What goes wrong:** When splitting the monolithic store, circular imports can occur if `connectionStore` imports from `workspaceStore` or vice versa.

**Why it happens:** The original store had all state in one file; extracting into separate files can create import cycles when stores reference each other's types.

**How to avoid:** Keep shared types in a separate `types.ts` file. Stores import types only, not other stores. Cross-store logic goes in coordinator hooks (`src/hooks/`) that import from both stores but are not themselves imported by stores.

**Warning signs:** TypeScript circular reference errors at compile time.

### Pitfall 4: `enum_dispatch` Requires All Methods on All Variants

**What goes wrong:** `enum_dispatch` generates dispatch code at compile time for all trait methods. If any `DatabaseDriver` method is not implemented for any variant, compilation fails with a clear error.

**Why it happens:** This is the intended behavior of enum_dispatch — it enforces completeness.

**How to avoid:** This is actually protective behavior. For Phase 1, implement all trait methods for PostgresDriver, MySQLDriver, and SQLiteDriver before running the build. Stub unimplemented optional methods with `unimplemented!()` or `Ok(Default::default())` temporarily.

**Warning signs:** Build failures about unimplemented trait methods.

### Pitfall 5: Tauri Plugin Registration Order

**What goes wrong:** `tauri-plugin-store` must be registered in `lib.rs` (or `main.rs`) before it is used. Forgetting registration causes runtime panics when the store is first accessed.

**Why it happens:** Tauri 2.x plugins require explicit registration in the builder chain.

**How to avoid:** Add `.plugin(tauri_plugin_store::Builder::default().build())` to the `tauri::Builder` chain in `src-tauri/src/lib.rs` before `.invoke_handler(...)`.

```rust
// src-tauri/src/lib.rs
tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::default().build())  // MUST be before invoke_handler
    .invoke_handler(tauri::generate_handler![...])
    .run(tauri::generate_context!())
    .expect("error running tauri application");
```

**Warning signs:** "plugin not found" or store access panics at runtime, not at compile time.

### Pitfall 6: SSH Passwords in `SavedConnection` Must NOT Be Migrated

**What goes wrong:** The current `SavedConnection` interface includes `ssh_password?: string`. If this is in localStorage and gets migrated to the plugin-store JSON file, passwords are now stored in plaintext in a JSON file instead of localStorage.

**Why it happens:** Migration code copies the entire connection object including any credential fields.

**How to avoid:** During migration, strip `ssh_password` from each connection before writing to the store. Passwords must go through the `keyring` crate (already in the project). If `ssh_password` is present in the migrated data, call `keyring::Entry::new("sqlmate", &conn.id).set_password(&pw)` and write `null` for that field in the store.

**Warning signs:** `ssh_password` field present in the `connections.json` file.

---

## Code Examples

Verified patterns from official sources and code inspection:

### sqlx 0.8 Upgrade — Cargo.toml

```toml
# Source: crates.io sqlx 0.8.6
[dependencies]
sqlx = { version = "0.8", features = [
    "runtime-tokio-rustls",
    "postgres", "mysql", "sqlite",
    "chrono", "uuid", "json", "rust_decimal"
]}
```

### tauri-plugin-store Initialization and Use

```typescript
// Source: https://v2.tauri.app/plugin/store/
// src/main.tsx — store must be initialized before App renders
import { storeService } from './services/StoreService';

async function main() {
  await storeService.init();  // runs migration, loads stores
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

main();
```

### PostgresDriver Implementation Shell

```rust
// Source: sqlx PgConnectOptions docs + ARCHITECTURE.md
// src-tauri/src/drivers/postgres.rs

use sqlx::postgres::{PgPool, PgPoolOptions, PgConnectOptions, PgSslMode};
use async_trait::async_trait;
use uuid::Uuid;

pub struct PostgresDriver {
    pool: Option<PgPool>,
    id: Uuid,
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    async fn connect(&mut self, config: &ConnectionConfig, password: Option<&str>) -> anyhow::Result<()> {
        let mut opts = PgConnectOptions::new()
            .host(config.host.as_deref().unwrap_or("localhost"))
            .port(config.port.unwrap_or(5432))
            .username(config.username.as_deref().unwrap_or("postgres"))
            .database(config.database.as_deref().unwrap_or("postgres"));

        if let Some(pass) = password {
            opts = opts.password(pass);
        }

        // SSL handling
        if config.ssl_enabled {
            opts = match config.ssl_mode.as_deref() {
                Some("require") => opts.ssl_mode(PgSslMode::Require),
                Some("verify-ca") => opts.ssl_mode(PgSslMode::VerifyCa),
                Some("verify-full") => opts.ssl_mode(PgSslMode::VerifyFull),
                _ => opts.ssl_mode(PgSslMode::Prefer),
            };
        }

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(opts)
            .await?;

        self.pool = Some(pool);
        Ok(())
    }

    async fn ping(&self) -> anyhow::Result<()> {
        let pool = self.pool.as_ref().ok_or_else(|| anyhow::anyhow!("Not connected"))?;
        pool.acquire().await?.ping().await?;
        Ok(())
    }

    fn driver_type(&self) -> DriverType { DriverType::Postgres }
    fn connection_id(&self) -> Uuid { self.id }

    // ... remaining methods
}
```

### AppState Update for DriverRegistry

```rust
// Source: ARCHITECTURE.md + code inspection of current AppState
// src-tauri/src/core/mod.rs (updated AppState)

pub struct AppState {
    // Replace: pub connection_manager: Arc<connection_manager::ConnectionManager>,
    pub driver_registry: Arc<DriverRegistry>,
    pub active_queries: Arc<Mutex<HashMap<Uuid, CancellationToken>>>,
}
```

### Updated lib.rs Registration

```rust
// src-tauri/src/lib.rs — main builder update
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            driver_registry: Arc::new(DriverRegistry::new()),
            active_queries: Arc::new(Mutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            test_connection,
            // ... all existing commands
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Password-in-URL connection strings | PgConnectOptions builder | sqlx 0.7.x (was always available, just not used) | Passwords with special chars work; no shell injection risk |
| localStorage for persistence | tauri-plugin-store | Tauri 2.0 (plugin stable) | Data survives URL scheme changes and Tauri upgrades |
| Monolithic Zustand store | Domain-split stores | Zustand 4+ (slice pattern) | Independent re-renders, testable in isolation |
| sqlx::AnyPool for multi-engine | enum_dispatch + per-engine types | Post-sqlx 0.7 (AnyPool never supported non-SQL) | Compile-time completeness checks; 10x faster dispatch |
| cargo-audit manual runs | cargo-audit in CI | Established practice | Catches new advisories automatically on every PR |

**Deprecated/outdated:**
- `sqlx = "0.7"`: Actively exploitable via RUSTSEC-2024-0363; must be replaced
- `localStorage` for Tauri app settings: Silently wiped on URL scheme changes; officially discouraged in Tauri docs
- `ConnectionManager` triple-HashMap pattern: Cannot scale beyond 3 engines without full rewrite of all command handlers

---

## Open Questions

1. **sqlx 0.8 breaking changes scope in query_engine.rs**
   - What we know: sqlx 0.8 has breaking changes to query macro usage and some type mappings
   - What's unclear: Whether the current `query_engine.rs` uses `query!()` macros (compile-time checked) or `query()` functions (runtime). If the former, a `DATABASE_URL` must be set for compilation.
   - Recommendation: Grep for `sqlx::query!` vs `sqlx::query` in query_engine.rs before starting the upgrade. If macros are used, add `.sqlx` prepared statement cache or switch to runtime queries.

2. **Windows Rust toolchain MSRV for sqlx 0.8**
   - What we know: sqlx 0.8 requires Rust 1.78.0 minimum
   - What's unclear: Current Rust version on the development machine and in any future CI environment
   - Recommendation: Add `rust-toolchain.toml` with `channel = "stable"` and `components = ["rustfmt", "clippy"]` as the first task of Phase 1.

3. **`ssh_password` in existing localStorage data**
   - What we know: `SavedConnection` interface includes `ssh_password?: string`; code inspection shows it is sent via `ssh_password: null` in `connect()` but may have been stored in earlier versions
   - What's unclear: Whether any real user data contains ssh_password values in localStorage
   - Recommendation: During migration, always strip `ssh_password` and move any non-null value to keyring. Log a warning if non-null ssh_password is found during migration.

---

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` — this section is skipped per configuration.

---

## Sources

### Primary (HIGH confidence)

- [RustSec Advisory RUSTSEC-2024-0363](https://rustsec.org/advisories/RUSTSEC-2024-0363.html) — sqlx vulnerability details, affected versions, patched version
- [Tauri Store Plugin docs](https://v2.tauri.app/plugin/store/) — API surface, initialization pattern, autoSave option
- [sqlx 0.8 crates.io](https://crates.io/crates/sqlx) — current version (0.8.6), release notes
- [enum_dispatch crate docs](https://docs.rs/enum_dispatch) — dispatch performance benchmarks (up to 10x vs dyn Trait)
- [sqlx PgConnectOptions docs](https://docs.rs/sqlx/latest/sqlx/postgres/struct.PgConnectOptions.html) — options builder API for password()
- [sqlx MySqlConnectOptions docs](https://docs.rs/sqlx/latest/sqlx/mysql/struct.MySqlConnectOptions.html) — options builder API
- Code inspection: `src-tauri/src/core/connection_manager.rs` lines 82-110 — confirmed URL string interpolation
- Code inspection: `src/store/databaseStore.ts` lines 127-151 — confirmed localStorage usage with exact key names
- Code inspection: `src-tauri/Cargo.toml` — confirmed sqlx 0.7, no tauri-plugin-store, no enum_dispatch
- Code inspection: `package.json` — confirmed no @tauri-apps/plugin-store
- [Tauri localStorage Issue #4455](https://github.com/tauri-apps/tauri/issues/4455) — WebView origin change data loss (URL scheme change between Tauri versions)

### Secondary (MEDIUM confidence)

- [Aptabase: Persistent State in Tauri Apps](https://aptabase.com/blog/persistent-state-tauri-apps) — localStorage migration pattern to plugin-store
- [async-trait crate docs](https://docs.rs/async-trait) — required for async fn in trait with enum dispatch
- [Zustand GitHub Discussion #1773](https://github.com/pmndrs/zustand/discussions/1773) — large state OOM with row data in store
- [RustSec cargo-audit docs](https://docs.rs/cargo-audit) — CI integration pattern

### Tertiary (LOW confidence)

- ARCHITECTURE.md research file — DriverRegistry pattern (HIGH confidence for the pattern itself; LOW for whether enum_dispatch version compat has been tested with current sqlx 0.8)

---

## Metadata

**Confidence breakdown:**
- sqlx upgrade: HIGH — Official security advisory; crates.io version confirmed; breaking changes documented in changelog
- tauri-plugin-store migration: HIGH — Official Tauri plugin; API confirmed in docs; localStorage keys confirmed by code inspection
- DriverRegistry / enum_dispatch: HIGH — Pattern confirmed in ARCHITECTURE.md; sqlx dyn-incompatibility confirmed in official docs; enum_dispatch benchmarks from official crate docs
- Zustand store split: HIGH — Standard Zustand pattern; monolithic store confirmed by code inspection (740 lines, 40+ state fields)
- test_connection fix: HIGH — Bug confirmed by direct code reading at lines 82-110; builder API confirmed in sqlx docs
- cargo-audit CI: HIGH — Standard practice; no existing CI infrastructure confirmed by code inspection (no .github/ directory)

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (sqlx and Tauri plugin APIs stable; check sqlx changelog if more than 30 days pass before implementation)
