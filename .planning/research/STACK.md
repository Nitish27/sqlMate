# Technology Stack

**Project:** sqlMate v1.0
**Researched:** 2026-03-02
**Overall confidence:** MEDIUM-HIGH (verified against official docs and crates.io where possible)

---

## Existing Foundation (Do Not Replace)

The current stack is already well-chosen. All additions below layer on top of it.

| Technology | Version | Role |
|------------|---------|------|
| Tauri | 2.x | Desktop app shell (Rust backend + WebView frontend) |
| React | 19.x | UI framework |
| TypeScript | 5.8.x | Type safety |
| Zustand | 5.x | Global state management |
| Monaco Editor | 0.55.x | Query editor |
| Tailwind CSS | 3.4.x | Styling |
| sqlx | 0.7.x | PostgreSQL, MySQL, SQLite drivers |
| TanStack Table | 8.x | Data grid |
| Radix UI | 2.x | Accessible UI primitives |

---

## Rust Backend: Database Drivers

### Tier 1: sqlx-Compatible (Extend Current Setup)

The project already uses `sqlx = "0.7"`. These databases work through sqlx directly:

| Database | Driver | Version | Notes |
|----------|--------|---------|-------|
| PostgreSQL | `sqlx` (postgres feature) | 0.7.x | Already implemented |
| MySQL | `sqlx` (mysql feature) | 0.7.x | Already implemented |
| SQLite | `sqlx` (sqlite feature) | 0.7.x | Already implemented |
| MariaDB | `sqlx` (mysql feature) | 0.7.x | Wire-compatible with MySQL driver. HIGH confidence |
| CockroachDB | `sqlx` (postgres feature) | 0.7.x | Wire-compatible with PostgreSQL driver. Use `sslmode=require` not `verify-full`. HIGH confidence |

**Upgrade note:** sqlx 0.8.x is available (latest 0.8.6). The breaking change is that `query*()` functions now require `impl SqlSafeStr`. Plan migration when starting NoSQL work. sqlx 0.8 does NOT have MSSQL support — MSSQL was dropped in 0.7 pending a rewrite.

### Tier 2: Native Rust Drivers (New Dependencies)

**Microsoft SQL Server (MSSQL)**

```toml
tiberius = { version = "0.12", features = ["tds73", "rustls"] }
tokio-util = { version = "0.7", features = ["compat"] }
```

- `tiberius` is the de facto Rust MSSQL driver. Maintained by Prisma team. Implements TDS 7.2+ protocol.
- Use `rustls` feature (not `native-tls`) for cross-platform consistency.
- Connection pooling: wrap with `bb8-tiberius` crate or `deadpool` manager.
- Confidence: HIGH (official Prisma project, actively maintained)

```toml
bb8 = "0.8"
bb8-tiberius = "0.12"
```

**Oracle**

```toml
oracle = "0.6"
```

- `oracle` crate by kubo. Based on ODPI-C (Oracle's official C thin driver).
- **Requires Oracle Instant Client installed on user machine** — this is a significant distribution concern for a desktop app. Bundle Instant Client or warn users.
- Alternative: `sibyl` (OCI-based, async-native). Less mature.
- Recommendation: Use `oracle = "0.6"` but gate the feature behind a "requires Oracle client" warning in the UI.
- Confidence: MEDIUM (driver works, distribution is the hard part)

**MongoDB**

```toml
mongodb = { version = "3", features = ["tokio-runtime"] }
bson = { version = "2", features = ["chrono-0_4"] }
```

- Official MongoDB Rust driver. In v3.0+, tokio is the only supported async runtime.
- Supports BSON natively. Works with Atlas and self-hosted.
- Confidence: HIGH (official driver, actively maintained by MongoDB)

**Redis**

```toml
fred = { version = "9", features = ["tokio-runtime", "pool"] }
```

- `fred` is recommended over `redis-rs` for a database tool context because it has built-in connection pooling, supports Cluster and Sentinel, and has comprehensive command coverage.
- Alternative: `deadpool-redis` (simpler, wraps `redis-rs`) is fine if only basic key-value browsing is needed.
- For sqlMate's use case (browsing key-value data, showing TTLs), `fred` is the better long-term choice.
- Confidence: MEDIUM (verified on crates.io, strong community adoption)

**ClickHouse**

```toml
clickhouse = { version = "0.13", features = ["lz4"] }
```

- Official ClickHouse Rust client (`ClickHouse/clickhouse-rs` on GitHub). Uses RowBinary format over HTTP.
- HTTP transport means no native binary protocol complexity.
- Enable `lz4` feature for data compression over the wire.
- Do NOT use `suharev7/clickhouse-rs` — it is the older community version, less maintained.
- Confidence: HIGH (official ClickHouse organization maintains this)

**DuckDB**

```toml
duckdb = { version = "1", features = ["bundled"] }
async-duckdb = "0.5"
```

- `duckdb` official Rust bindings (maintained by DuckDB organization). Use `bundled` feature to embed DuckDB so users don't need a separate install.
- `duckdb` itself is synchronous. Use `async-duckdb` wrapper to integrate with Tokio without blocking.
- `async-duckdb` runs DuckDB in a background thread with message passing.
- Confidence: HIGH (both are official/well-maintained)

**Cassandra / ScyllaDB**

```toml
cdrs-tokio = "8"
```

- Pure-async Cassandra driver, 100% Rust, no C library dependency.
- Alternative: `cassandra-rs` wraps the DataStax C++ driver (harder to cross-compile for desktop distribution).
- `cdrs-tokio` is preferred for a Tauri app because it compiles cleanly without native library dependencies.
- Also serves ScyllaDB (CQL-compatible).
- Confidence: MEDIUM (actively maintained, production-used, but less ecosystem than Java/Python drivers)

**Turso / libSQL**

```toml
libsql = { version = "0.6", features = ["remote"] }
```

- Official libSQL Rust SDK by the Turso team. Supports local file, remote HTTP, and embedded replicas.
- Use `remote` feature for connecting to Turso cloud endpoints.
- Confidence: HIGH (official Turso SDK)

**Snowflake**

```toml
snowflake-api = "0.9"
```

- Uses Snowflake's undocumented-but-stable HTTP API (same as official clients use internally).
- No official Snowflake Rust driver exists — this is the best available option.
- Alternative: `snowflake-connector-rs` (newer, REST-based, less battle-tested).
- Confidence: LOW (no official Rust driver from Snowflake; `snowflake-api` is community-maintained)

**BigQuery**

```toml
gcp-bigquery-client = "0.24"
```

- Supports BigQuery REST API. Handles GCP authentication (service account, ADC, workload identity).
- Alternative: `google-cloud-bigquery` (newer, less documentation).
- Confidence: MEDIUM (community-maintained, functional, documented)

**Amazon Redshift**

- Redshift uses the PostgreSQL wire protocol. Use `sqlx` with the `postgres` feature.
- No dedicated Redshift Rust driver exists or is needed.
- Connection requires SSL. Use `sslmode=require` in the connection string.
- Confidence: HIGH (Redshift officially supports PostgreSQL drivers)

**Vertica**

```toml
odbc-api = "10"
```

- No native Rust Vertica driver exists. Use ODBC bridge via `odbc-api`.
- Requires Vertica ODBC driver installed on user machine (vertica-odbc package).
- This is a significant distribution concern. Gate behind "requires Vertica ODBC driver" warning.
- Confidence: LOW (indirect approach, user must install ODBC driver)

### Driver Strategy Summary

```
Simple (already done):     PostgreSQL, MySQL, SQLite → sqlx
Drop-in extension:         MariaDB, CockroachDB, Redshift → same sqlx feature flags
Pure-Rust new drivers:     MSSQL (tiberius), Cassandra (cdrs-tokio), ClickHouse (clickhouse), DuckDB (duckdb), libSQL (libsql)
Native MongoDB:            mongodb official driver
High-confidence cloud:     Snowflake (snowflake-api), BigQuery (gcp-bigquery-client)
Requires external install: Oracle (oracle + Instant Client), Vertica (odbc-api + ODBC driver)
```

---

## Rust Backend: Supporting Infrastructure

### SSH Tunneling (Upgrade from ssh2)

The project currently uses `ssh2 = "0.9"` which is synchronous. For new database drivers that need tunneling:

```toml
# Keep existing ssh2 for current implementations
ssh2 = "0.9"

# Add async SSH for new drivers needing Tokio-native tunneling
async-ssh2-tokio = "0.8"
```

`async-ssh2-tokio` is built on `russh` and provides `open_direct_tcpip_channel` for port forwarding. The project's existing SSH tunneling works for sqlx. New drivers that require async-native tunneling should use `async-ssh2-tokio`.

### Connection Pooling

sqlx already includes its own pool (`sqlx::Pool`). For drivers without built-in pooling:

```toml
bb8 = "0.8"                    # For tiberius (MSSQL)
deadpool = { version = "0.12", features = ["managed"] }   # General purpose
```

### Backup / Restore

Do NOT try to reimplement `pg_dump` or `mysqldump` in Rust. Instead, use Tauri's shell/sidecar to invoke the official CLI tools:

- Bundle `pg_dump` / `pg_restore` binaries as sidecars in the Tauri app
- Bundle `mysqldump` / `mysql` binaries as sidecars
- Use `tauri-plugin-shell` to execute them with `Command::new_sidecar()`
- This is the only reliable approach that handles all schema objects, large datasets, and format compatibility

```toml
# Cargo.toml - already have tauri-plugin-dialog, add shell if needed
tauri-plugin-shell = "2"
```

```json
// tauri.conf.json - register sidecars
{
  "bundle": {
    "externalBin": ["bin/pg_dump", "bin/pg_restore", "bin/mysqldump"]
  }
}
```

---

## Frontend: Monaco Editor Extensions

### SQL Autocomplete

The project already uses `monaco-editor` and `@monaco-editor/react`. Current setup has no autocomplete.

**Recommended approach: `monaco-sql-languages`**

```bash
npm install monaco-sql-languages
```

- `monaco-sql-languages` by DTStack (GitHub: DTStack/monaco-sql-languages)
- Supports: MySQL, PostgreSQL, Flink, Spark, Hive, Trino, Impala dialects
- Provides keyword completion out of the box
- Accepts a custom `completionService` function that receives syntax context + tables/columns in scope
- The `completionService` is where you inject schema-aware suggestions from the Rust backend
- **Caveat:** The package currently guarantees stability only on `monaco-editor@0.37.x`. sqlMate currently uses `0.55.x`. Test for compatibility; the API surface for completion providers has not changed significantly.
- Confidence: MEDIUM (well-maintained, production-used by DTStack products, version compatibility needs verification)

**Implementation pattern for schema-aware completion:**

```typescript
import { setupLanguageFeatures, LanguageIdEnum } from 'monaco-sql-languages';

setupLanguageFeatures(LanguageIdEnum.PG, {
  completionService: async (model, position, completionContext, suggestions) => {
    // `suggestions` includes parsed table names from current query context
    // Fetch column names from Rust backend via invoke()
    const schema = await invoke('get_schema_for_completion', {
      connectionId, tables: suggestions.syntax?.tables
    });
    return schema; // Return CompletionItem[]
  }
});
```

**Alternative: Roll your own using Monaco's built-in completion API**

```typescript
monaco.languages.registerCompletionItemProvider('sql', {
  triggerCharacters: ['.', ' '],
  provideCompletionItems: async (model, position) => {
    // Fetch schema from backend, return suggestions
  }
});
```

This is more work but gives full control and no version dependency concerns.

**Do NOT consider CodeMirror 6 as a replacement.** The project is already invested in Monaco. Switching would be a rewrite of the query editor. Monaco's completion API is powerful enough.

### SQL Formatting (Already Included)

`sql-formatter` is already in the dependency list. No changes needed.

---

## Frontend: Charts / Metrics Dashboard

### Recommended: Recharts

```bash
npm install recharts
```

- Already the de facto React chart library. 24K+ GitHub stars.
- SVG-based. Works well for dashboards showing query metrics, connection stats, slow query timelines.
- Composable API matches React's component model.
- Confidence: HIGH

**Why not alternatives:**

| Library | Verdict |
|---------|---------|
| `echarts-for-react` | Overkill for a metrics sidebar. Canvas-based, large bundle. Use only if rendering 10K+ data points per chart. |
| `tremor` | Built on Recharts. Adds Tailwind styling sugar. Reasonable option but adds a Radix+Tailwind assumption layer. Since sqlMate already uses Radix UI and Tailwind directly, using Recharts without Tremor is cleaner. |
| `visx` | Too low-level. Build your own chart library on top of D3 primitives. Not worth the effort for a database tool. |
| `react-chartjs-2` | Canvas-based, better for huge datasets. Not needed here. |

**Specific chart types needed for sqlMate:**

```bash
# Recharts provides all of these:
# - LineChart (query latency over time)
# - BarChart (queries per second, table row counts)
# - AreaChart (connection pool usage)
# - PieChart / RadialBar (database size breakdown)
```

---

## Frontend: Keyboard Shortcut Management

### Recommended: `react-hotkeys-hook`

```bash
npm install react-hotkeys-hook
```

- The standard React keyboard shortcut library. 3.1K+ GitHub stars.
- Hook-based API. Supports scopes to namespace shortcuts per context (e.g., query editor vs. table grid).
- Works well with Tauri — the library handles keyboard events in the webview.
- Confidence: HIGH

```typescript
import { useHotkeys } from 'react-hotkeys-hook';

// Scope shortcuts to specific components
useHotkeys('mod+enter', () => executeQuery(), { scopes: ['query-editor'] });
useHotkeys('mod+w', () => closeTab(), { scopes: ['tab-bar'] });
```

**For global OS-level shortcuts** (e.g., summon app from anywhere), use Tauri's plugin:

```bash
npm install @tauri-apps/plugin-global-shortcut
```

```toml
tauri-plugin-global-shortcut = "2"
```

This registers shortcuts at the OS level. Register sparingly — only for "open sqlMate" style shortcuts.

**Do NOT use `tinykeys`.** It is minimal/lightweight but lacks the scope system needed for a complex multi-panel app.

---

## Frontend: State Management

### Current: Zustand 5 (Keep and Extend)

The existing single `databaseStore.ts` (260+ line interface) is already working but will become unwieldy at v1.0 scale. The recommended pattern is **store slicing** — splitting the single store into composable slices that are combined.

```typescript
// Zustand slice pattern (v5 compatible)
const createConnectionSlice = (set, get) => ({
  // connection state
});

const createTabSlice = (set, get) => ({
  // tab state
});

const createUISlice = (set, get) => ({
  // UI state
});

export const useDatabaseStore = create((...a) => ({
  ...createConnectionSlice(...a),
  ...createTabSlice(...a),
  ...createUISlice(...a),
}));
```

This keeps a single store (no prop drilling) while making files manageable. Do NOT split into multiple `create()` stores — that creates coordination problems for cross-slice actions.

For metrics/chart data that is server-fetched, consider **TanStack Query**:

```bash
npm install @tanstack/react-query
```

Use Zustand for UI/connection/tab state. Use TanStack Query for data fetched from the Rust backend (table rows, metrics, schema). This avoids caching row data in Zustand's ephemeral state.

---

## Frontend: Theming (Light / Dark Mode)

### Current Situation

`theme: 'dark' | 'light'` is already in `databaseStore.ts`. The UI is currently dark-only based on the CSS.

### Recommended Implementation

**Use Tailwind's `class` strategy (already correct for this use case).**

The project uses Tailwind 3.4.x. In v3, configure:

```javascript
// tailwind.config.js
module.exports = {
  darkMode: 'class',  // Toggle via .dark class on <html>
  // ...
}
```

Apply theme class from the Zustand store:

```typescript
// In App.tsx
const theme = useDatabaseStore(s => s.theme);

useEffect(() => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('light', theme === 'light');
}, [theme]);
```

Persist theme preference with `tauri-plugin-store` (not localStorage, so it survives app reinstalls):

```bash
npm install @tauri-apps/plugin-store
```

```toml
tauri-plugin-store = "2"
```

**If upgrading to Tailwind v4** (not required for v1.0):

In v4, dark mode is CSS-first. Replace `tailwind.config.js` entry with CSS:

```css
/* In your main CSS file */
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

Behavior is identical from the component perspective — `dark:bg-gray-900` etc. still work.

**Do not use `next-themes`.** This is a Tauri app, not Next.js.

---

## Tauri 2.x Capabilities

### File Dialogs (Already Installed)

`tauri-plugin-dialog` is already in the project. Ensure capabilities are configured:

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "dialog:allow-open",
    "dialog:allow-save",
    "dialog:allow-message",
    "dialog:allow-confirm"
  ]
}
```

Available dialog types: file open (with multi-select), file save, message, confirm/ask.

### System Tray

```toml
# Cargo.toml
tauri = { version = "2", features = ["tray-icon"] }
```

```json
// tauri.conf.json
{
  "app": {
    "trayIcon": {
      "iconPath": "icons/tray.png",
      "iconAsTemplate": true
    }
  }
}
```

No additional plugin needed — system tray is built into Tauri 2 core.

### Window State Persistence

```bash
npm install @tauri-apps/plugin-window-state
```

```toml
tauri-plugin-window-state = "2"
```

Saves and restores window size/position across restarts. Essential for a desktop tool.

### Multi-Window Support

Tauri 2 supports multiple windows via `WebviewWindow`. For sqlMate, separate windows per connection is a TablePlus feature worth supporting:

```typescript
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const newWin = new WebviewWindow('connection-window', {
  url: '/',
  title: connectionName,
});
```

Requires `core:webview:allow-create-webview-window` permission in capabilities.

### Custom Window Decorations (TablePlus aesthetic)

```bash
npm install @tauri-apps/plugin-decorum  # community plugin
```

```toml
tauri-plugin-decorum = "0.3"
```

`tauri-plugin-decorum` provides transparent/overlay titlebars on both Windows and macOS while retaining native features (Windows Snap Layout on Windows, traffic lights on macOS). This is the most practical solution for the TablePlus-like native look.

Alternatively, use `tauri-controls` npm package for native-looking window control buttons in the webview:

```bash
npm install tauri-controls
```

### Persistent Store

```bash
npm install @tauri-apps/plugin-store
```

```toml
tauri-plugin-store = "2"
```

Use for: app preferences, API keys, theme preference, window layout settings. NOT for connection passwords (use `keyring` which is already in the project). NOT for large datasets (use the connection's database).

### Shell / Sidecar (For Backup Tools)

```bash
npm install @tauri-apps/plugin-shell
```

```toml
tauri-plugin-shell = "2"
```

Required for invoking `pg_dump`, `mysqldump`, and other CLI tools bundled as sidecars.

---

## Full Dependency Reference

### Cargo.toml Additions

```toml
[dependencies]
# Existing (keep)
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-opener = "2"
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.7", features = ["runtime-tokio-rustls", "postgres", "mysql", "sqlite", "chrono", "uuid", "json", "rust_decimal"] }
keyring = "2"
aes-gcm = "0.10"
anyhow = "1.0"
thiserror = "1.0"
chrono = { version = "0.4", features = ["serde"] }
rust_decimal = "1.33"
futures = "0.3"
uuid = { version = "1.0", features = ["v4", "serde"] }
ssh2 = "0.9"
csv = "1.3"
tokio-util = "0.7"
reqwest = { version = "0.12", features = ["json"] }
dotenvy = "0.15"
dirs = "5.0"

# New: Tauri plugins
tauri-plugin-store = "2"
tauri-plugin-shell = "2"
tauri-plugin-window-state = "2"
tauri-plugin-global-shortcut = "2"

# New: MSSQL
tiberius = { version = "0.12", features = ["tds73", "rustls"] }
bb8 = "0.8"
bb8-tiberius = "0.12"

# New: Oracle (requires Oracle Instant Client on user machine)
oracle = "0.6"

# New: MongoDB
mongodb = { version = "3", features = ["tokio-runtime"] }
bson = { version = "2", features = ["chrono-0_4"] }

# New: Redis
fred = { version = "9", features = ["tokio-runtime", "pool"] }

# New: ClickHouse
clickhouse = { version = "0.13", features = ["lz4"] }

# New: DuckDB
duckdb = { version = "1", features = ["bundled"] }
async-duckdb = "0.5"

# New: Cassandra
cdrs-tokio = "8"

# New: Turso / libSQL
libsql = { version = "0.6", features = ["remote"] }

# New: Snowflake (community, no official Rust driver)
snowflake-api = "0.9"

# New: BigQuery
gcp-bigquery-client = "0.24"

# New: Vertica via ODBC (requires ODBC driver on user machine)
odbc-api = "10"

# New: async SSH for new drivers
async-ssh2-tokio = "0.8"

# New: connection pooling for non-sqlx drivers
deadpool = { version = "0.12", features = ["managed"] }
```

### package.json Additions

```bash
# SQL autocomplete
npm install monaco-sql-languages

# Charts
npm install recharts
npm install @types/recharts   # if not bundled

# Keyboard shortcuts
npm install react-hotkeys-hook

# Tauri plugins
npm install @tauri-apps/plugin-store
npm install @tauri-apps/plugin-shell
npm install @tauri-apps/plugin-window-state
npm install @tauri-apps/plugin-global-shortcut

# State management (optional, for server data caching)
npm install @tanstack/react-query

# Window decorations (optional, for TablePlus native look)
npm install tauri-controls
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| MSSQL driver | `tiberius` | `sqlx-oldapi` fork | sqlx-oldapi is unmaintained; tiberius is the Prisma-backed standard |
| Oracle driver | `oracle` | `sibyl` | sibyl is async-native but less documented; oracle is more battle-tested |
| MongoDB | `mongodb` official | `wither` ORM | sqlMate needs raw access, not an ORM |
| Redis | `fred` | `deadpool-redis` | fred has built-in cluster/sentinel; deadpool-redis is simpler but less featured for a GUI tool |
| ClickHouse | `clickhouse` (official) | `klickhouse` | official driver is maintained by ClickHouse team |
| Cassandra | `cdrs-tokio` | `cassandra-rs` | cassandra-rs requires DataStax C++ lib, hard to cross-compile for desktop |
| Charts | `recharts` | `echarts-for-react` | echarts is heavier; SVG charts are fine for a metrics panel |
| Charts | `recharts` | `tremor` | tremor is recharts + Tailwind sugar; adds a dependency layer with no new capability |
| SQL autocomplete | `monaco-sql-languages` | Custom completion provider | monaco-sql-languages saves time; roll custom if version compat is an issue |
| Hotkeys | `react-hotkeys-hook` | `tinykeys` | tinykeys lacks scope system needed for multi-panel app |
| Theme persistence | `tauri-plugin-store` | `localStorage` | localStorage is ephemeral and less appropriate for app settings in a native app |
| Snowflake | `snowflake-api` | JDBC via sidecar | Native Rust driver (even community) is preferable to JVM dependency |
| Vertica | `odbc-api` | Native driver | No native Rust Vertica driver exists; ODBC is the only realistic path |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| sqlx-compatible DBs (MariaDB, CockroachDB, Redshift) | HIGH | Wire-compatible with existing drivers, documented by those vendors |
| MSSQL (tiberius) | HIGH | Official Prisma project, well documented |
| MongoDB | HIGH | Official driver from MongoDB |
| ClickHouse | HIGH | Official driver from ClickHouse team |
| DuckDB | HIGH | Official bindings from DuckDB |
| libSQL / Turso | HIGH | Official SDK from Turso |
| Cassandra (cdrs-tokio) | MEDIUM | Pure Rust, works, but less ecosystem depth than JVM drivers |
| Redis (fred) | MEDIUM | Strong library, but fred v9 API should be verified against latest docs |
| Oracle | MEDIUM | Driver works; Instant Client distribution is the risk |
| BigQuery | MEDIUM | Community crate, functional but not official Google SDK |
| Snowflake | LOW | No official Rust driver; community crate uses undocumented API |
| Vertica | LOW | ODBC bridge, requires user-installed driver, not ideal UX |
| monaco-sql-languages | MEDIUM | Version compat with monaco 0.55 needs testing |
| recharts | HIGH | Industry standard React chart library |
| react-hotkeys-hook | HIGH | Standard choice, well documented |
| Tauri 2 plugins | HIGH | Official Tauri team plugins |

---

## Sources

- [sqlx GitHub](https://github.com/launchbadge/sqlx) — postgres, mysql, sqlite, MariaDB support
- [tiberius GitHub](https://github.com/prisma/tiberius) — MSSQL driver
- [mongodb Rust driver docs](https://www.mongodb.com/docs/drivers/rust/current/) — MongoDB official
- [ClickHouse Rust client docs](https://clickhouse.com/docs/integrations/rust) — official clickhouse crate
- [DuckDB Rust client docs](https://duckdb.org/docs/stable/clients/rust) — official duckdb-rs
- [Turso Rust quickstart](https://docs.turso.tech/sdk/rust/quickstart) — libsql crate
- [oracle crate docs](https://docs.rs/oracle) — Oracle driver
- [cdrs-tokio GitHub](https://github.com/krojew/cdrs-tokio) — Cassandra driver
- [gcp-bigquery-client crates.io](https://crates.io/crates/gcp-bigquery-client) — BigQuery
- [snowflake-api docs.rs](https://docs.rs/snowflake-api) — Snowflake community driver
- [odbc-api crates.io](https://crates.io/crates/odbc-api) — ODBC for Vertica
- [CockroachDB Rust docs](https://www.cockroachlabs.com/docs/stable/build-a-rust-app-with-cockroachdb) — PostgreSQL compat
- [DTStack monaco-sql-languages](https://github.com/DTStack/monaco-sql-languages) — SQL autocomplete
- [react-hotkeys-hook](https://react-hotkeys-hook.vercel.app/) — keyboard shortcuts
- [Tauri 2 Dialog plugin](https://v2.tauri.app/plugin/dialog/) — file dialogs
- [Tauri 2 Global Shortcut](https://v2.tauri.app/plugin/global-shortcut/) — OS-level hotkeys
- [Tauri 2 Store plugin](https://v2.tauri.app/plugin/store/) — persistent storage
- [Tauri 2 Window Customization](https://v2.tauri.app/learn/window-customization/) — decorations
- [tauri-plugin-decorum](https://github.com/clearlysid/tauri-plugin-decorum) — native titlebars
- [Tailwind dark mode docs](https://tailwindcss.com/docs/dark-mode) — class strategy
- [LogRocket React chart libraries 2025](https://blog.logrocket.com/best-react-chart-libraries-2025/) — chart comparison
- [async-ssh2-tokio](https://github.com/Miyoshi-Ryota/async-ssh2-tokio) — async SSH tunneling
