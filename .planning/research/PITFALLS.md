# Domain Pitfalls

**Domain:** Desktop database management tool (Tauri 2.x + React 18 + TypeScript + Zustand + Monaco Editor + SQLx)
**Researched:** 2026-03-02
**Project Version:** sqlMate v0.4.1, targeting v1.0 milestone

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or major security incidents.

---

### Pitfall 1: sqlx 0.7 Has an Unpatched Security Vulnerability (RUSTSEC-2024-0363)

**What goes wrong:** The project currently uses `sqlx = "0.7"`. A confirmed binary protocol vulnerability exists in all sqlx versions <= 0.8.0. Encoding a value larger than 4 GiB causes the length prefix in the binary wire protocol to overflow, causing the PostgreSQL server to misinterpret the remainder of the buffer as executable protocol commands. A working exploit has been publicly demonstrated for PostgreSQL.

**Why it happens:** Truncating integer casts in `sqlx-postgres/src/arguments.rs` — code that has existed since the library's beginning.

**Consequences:** Remote code execution potential on the PostgreSQL server. MySQL and SQLite are not currently believed to be exploitable, but are still affected.

**Prevention:** Upgrade sqlx to `>= 0.8.1` immediately before adding any new database engines. This is not a minor upgrade — 0.8.x has breaking changes. The MSRV jumps to Rust 1.78.0. The MSSQL driver was removed from sqlx in 0.7 entirely, so any plans for MSSQL support require a third-party driver anyway.

**Detection:** Run `cargo audit` in CI. The advisory is RUSTSEC-2024-0363.

**Sources:** [RustSec Advisory Database](https://rustsec.org/advisories/RUSTSEC-2024-0363.html) — HIGH confidence, official security advisory.

---

### Pitfall 2: localStorage Is Not a Reliable Persistence Layer for a Desktop App

**What goes wrong:** The current codebase uses `localStorage` for saved connections and query history (`sqlmate_saved_connections`, `sqlmate_query_history`). In Tauri, localStorage is stored inside the WebView's internal profile directory and is tied to the URL scheme. When Tauri changes are made (port changes, scheme changes between dev and production, or upgrades), the WebView treats it as a different origin, silently discarding all stored data.

**Why it happens:** Tauri 2.0 changed Windows from `https://tauri.localhost` to `http://tauri.localhost`. Any existing users who had data in the old scheme had their localStorage silently wiped. localStorage is also capped at 3-5 MB depending on the platform and cannot be accessed from Rust.

**Consequences:** Users lose saved connections on app upgrades. No migration path exists. SSH passwords stored in `ssh_password` field of `SavedConnection` are persisted in plaintext in localStorage despite the keyring implementation existing.

**Prevention:**
1. Migrate to `tauri-plugin-store` for all persistent data (connections, history, settings). It writes to a JSON file in the app's data directory, is accessible from both Rust and JS, and survives URL scheme changes.
2. Add a one-time migration path that reads from localStorage on first launch after update and writes to the new store.
3. Never persist any credentials in any storage layer other than the OS keychain.

**Detection:** Check if `localStorage.getItem('sqlmate_saved_connections')` returns data after a fresh install or scheme change.

**Sources:** [Aptabase blog on persistent state in Tauri](https://aptabase.com/blog/persistent-state-tauri-apps), [Tauri Store Plugin docs](https://v2.tauri.app/plugin/store/), [Tauri GitHub Issue #4455](https://github.com/tauri-apps/tauri/issues/4455) — HIGH confidence, official documentation.

---

### Pitfall 3: SSH Tunnel Implementation Has Correctness and Safety Issues

**What goes wrong:** The current `establish_ssh_tunnel` implementation in `connection_manager.rs` uses a hand-rolled bidirectional copy loop with busy-poll sleeping (`thread::sleep(5ms)`) when no data is active. libssh2 is explicitly **not thread-safe** — `libssh2_init` must be called once, and sharing a Session across threads requires explicit mutex synchronization. The current code shares a `Arc<Mutex<Session>>` across the spawned per-connection threads, which is the correct pattern, but the blocking/non-blocking mode is toggled inside each thread's loop, creating race conditions between threads operating on the same session.

**Why it happens:** libssh2's C API does not have built-in thread safety. The Rust `ssh2` crate inherits this limitation. Non-blocking mode is session-global, not channel-local.

**Consequences:**
- Race condition: Thread A sets session to blocking, Thread B reads in non-blocking mode mid-operation, causing `LIBSSH2_ERROR_EAGAIN` loops or channel death.
- Only one active channel per connection can safely run at a time with this design.
- When the SSH connection drops, the inner `listener.incoming()` loop blocks forever.

**Prevention:**
- Use one SSH session per TCP connection (not shared across multiple channels).
- Consider replacing the hand-rolled SSH tunnel with `russh` (pure async Rust) or managing the blocking loop in a dedicated thread with a `channel::oneshot` for shutdown.
- Add explicit connection keepalive (`Session::keepalive_send`) to detect dead connections.
- Add a read timeout on the listener to allow the spawned task to notice when it should stop.

**Detection:** Attempt to open two concurrent queries on an SSH-tunneled connection and monitor for hangs or protocol errors.

**Sources:** [libssh2 thread safety discussion](https://libssh2-devel.cool.haxx.narkive.com/uc4DbQEq/libssh2-thread-safety), [libssh2 blocking issue #105](https://github.com/libssh2/libssh2/issues/105) — MEDIUM confidence, community discussion corroborated by code inspection.

---

### Pitfall 4: IPC Performance Collapses for Large Result Sets on Windows

**What goes wrong:** All data returned from Tauri `invoke()` calls is serialized to JSON, transmitted through the IPC channel (which uses the WebView's fetch API internally), then deserialized in JS. For result sets with thousands of rows or columns with large text/binary values, this can take 200ms+ on Windows even with Tauri 2.0's "raw IPC" mode, because the Windows WebView2 implementation has measurably worse IPC performance than macOS (5ms vs 200ms for 10 MB of data).

**Why it happens:** Windows WebView2 uses a different underlying architecture than macOS WKWebView. The serialize-to-JSON + IPC + deserialize-from-JSON round trip is unavoidable for standard `invoke()`.

**Consequences:** Fetching a table with 10,000 rows and 20 columns of text data can produce a response payload of several MB, causing multi-second UI freezes.

**Prevention:**
1. The project already uses streaming (the `streaming_query` event emitter pattern in `query_engine.rs`) — this is the correct approach. Enforce it for all large queries.
2. Set a hard per-page cap (current default: 100 rows) and never raise it beyond 1,000 rows per IPC call.
3. For metrics/chart data, pre-aggregate in Rust before returning; never send raw row data to be aggregated in JS.
4. For BLOB columns, do not serialize binary data as JSON — use base64 and stream them separately or display placeholders.

**Detection:** Measure IPC round-trip time on Windows for a 500-row result with 50 text columns. Time the `invoke()` call with `performance.now()`.

**Sources:** [Tauri IPC Discussion #11915](https://github.com/tauri-apps/tauri/discussions/11915), [Tauri IPC Issue #7127](https://github.com/tauri-apps/tauri/issues/7127) — HIGH confidence, from Tauri maintainers.

---

### Pitfall 5: Monaco Editor Completion Providers Are Global, Not Instance-Scoped

**What goes wrong:** Monaco Editor registers language completion providers globally per-language (`monaco.languages.registerCompletionItemProvider('sql', ...)`). When multiple SQL editor tabs are open simultaneously (each for a different connection and database), they all share the same completion provider. Provider A (for PostgreSQL database X) will inject its table/column suggestions into editor B (for MySQL database Y).

**Why it happens:** Monaco's architecture is designed around a single editor-per-page model. Language services are global singletons. There is no first-class API to scope a completion provider to a specific editor instance — this is a confirmed known limitation tracked at [microsoft/monaco-editor #593](https://github.com/microsoft/monaco-editor/issues/593), open since 2017.

**Consequences:**
- Autocomplete shows wrong database's schema in multi-tab scenarios.
- Duplicate suggestions appear (each editor registration appends, not replaces).
- SSH password suggestions from one connection bleed into another.

**Prevention:**
1. Register only one completion provider per language, globally, and pass a reference to the currently active editor's connection context.
2. Use `editor.getModel().uri` to identify which editor is focused and look up the correct schema context from a global registry.
3. Call `dispose()` on the previous provider and re-register when the active tab changes, but be aware this causes a visible flicker delay.
4. The library `monaco-sql-languages` from DTStack handles this pattern and is worth evaluating.

**Detection:** Open two SQL tabs connected to different databases. Type a table name in tab 2 and observe if tab 1's tables appear in completions.

**Sources:** [Monaco Editor Issue #593](https://github.com/microsoft/monaco-editor/issues/593), [Monaco Editor Issue #2792](https://github.com/microsoft/monaco-editor/issues/2792), [monaco-sql-languages README](https://github.com/DTStack/monaco-sql-languages/blob/main/README.md) — HIGH confidence, confirmed known bug in Monaco since 2017.

---

## Moderate Pitfalls

### Pitfall 6: keyring Crate Fails Silently on Headless Linux Systems

**What goes wrong:** The `keyring = "2"` crate uses the OS keychain (gnome-keyring / KWallet on Linux, Keychain on macOS, Windows Credential Store on Windows). On Linux systems without a running D-Bus session or without gnome-keyring/KWallet installed (CI environments, minimal server distros, or Wayland-first setups without a keyring daemon), the crate throws an error that is currently silently swallowed.

**Why it happens:** gnome-keyring requires a D-Bus session and an unlocked keyring daemon. On headless Linux, the daemon is never started, and the Secret Service D-Bus interface is unavailable.

**Consequences:**
- Password saving silently fails. Next time the user opens the app, no password is stored and the connection fails.
- No error is surfaced to the user.
- In the current code, `SecureStore::save_password` maps errors to `anyhow`, but the IPC handler may not propagate this to the UI.

**Prevention:**
1. Always fall back gracefully: if keyring is unavailable, prompt the user for the password on each connection attempt (session-only credential).
2. Detect keyring availability at startup and surface a warning in the UI ("OS keychain unavailable — passwords will not be saved").
3. Consider `keyring-rs` v3 which has improved fallback behavior documentation.

**Detection:** Run the app on a headless Ubuntu server without gnome-keyring. Attempt to save a connection with a password.

**Sources:** [keyring-rs GitHub](https://github.com/hwchen/keyring-rs), [Rust Forum discussion on keyring/secret-service](https://users.rust-lang.org/t/keyring-secret-service-libraries/4567) — MEDIUM confidence.

---

### Pitfall 7: Supporting 14 New Database Engines Creates an Unmaintainable Feature Matrix

**What goes wrong:** Each new database engine (Oracle, MSSQL, Redis, MongoDB, ClickHouse, CockroachDB, etc.) has different:
- Wire protocol and driver crate (sqlx has no Oracle or MongoDB support)
- SQL dialect (e.g., `TOP N` vs `LIMIT N`, `IDENTITY` vs `SERIAL` vs `AUTOINCREMENT`)
- Schema introspection queries (information_schema availability varies)
- Connection string format
- SSL/TLS requirements
- User/permission management model
- Data type system (e.g., Oracle's NUMBER vs PostgreSQL's NUMERIC)

sqlx explicitly removed MSSQL support starting in 0.7, and has no Oracle driver at all. Adding these requires separate driver crates, each with their own maintenance burden. Redis and MongoDB are fundamentally non-relational and require a completely different query model.

**Why it happens:** The community assumption is that "SQL is SQL" — it is not. Supporting 17 engines simultaneously is the full scope of tools like DBeaver that have been in development for 10+ years with a full-time team.

**Consequences:**
- Each engine needs custom schema introspection queries.
- Table structure editing has different DDL syntax per engine.
- Backup/restore relies on external binaries that may not be available.
- Testing matrix becomes 17x larger.
- Each engine bug is invisible until a user with that specific database reports it.

**Prevention:**
1. Prioritize based on actual user demand. PostgreSQL, MySQL, SQLite are 90% of the use case.
2. Build a clean `DatabaseDriver` trait abstraction first, then implement engines one at a time with an explicit feature matrix (document what works per engine).
3. For non-relational engines (Redis, MongoDB), build a read-only data explorer first before attempting query editing.
4. MSSQL on sqlx requires either the unmaintained 0.6.x branch or a complete rewrite using `tiberius` crate.
5. Oracle requires a proprietary C library (OCI) — this creates significant binary size and licensing complexity for a desktop app.

**Detection:** Attempt to run the full feature set (structure edit, backup, user management) against each proposed engine before committing to it in the roadmap.

**Sources:** [sqlx cross-engine discussion](https://github.com/launchbadge/sqlx/discussions/4030), [DBeaver documentation](https://dbeaver.com/docs/dbeaver/Local-Client-Configuration/) — MEDIUM confidence.

---

### Pitfall 8: Backup/Restore Depends on External Binaries That Are Never Guaranteed to Exist

**What goes wrong:** PostgreSQL backup (pg_dump/pg_restore) and MySQL backup (mysqldump) require external CLI binaries. On Windows, these are only available if the user has installed the full PostgreSQL or MySQL client, and even then, the version of pg_dump must match the server version. Multiple pg_dump versions from different installations (pgAdmin, full PostgreSQL, extensions) can coexist and cause version mismatch failures.

**Why it happens:** pg_dump must match the server major version. If the server is PostgreSQL 17 but only pg_dump 14 is installed, the backup fails with a cryptic version mismatch error.

**Consequences:**
- The backup feature appears to work in testing but fails in production on user machines.
- On Windows, paths with spaces (`C:\Program Files\PostgreSQL\17\bin`) require quoting in shell invocations.
- On macOS with Homebrew or App Store installations, binaries are in non-standard locations.

**Prevention:**
1. Detect the server version and the local pg_dump version at connection time, warn if mismatched.
2. Allow users to configure the path to the backup binaries explicitly.
3. Ship bundled, statically linked backup tools for the three core engines where licensing permits.
4. For SQLite, use sqlx directly (no external binary needed).
5. Document minimum binary version requirements prominently.

**Detection:** Test backup on a clean Windows machine with only pgAdmin installed (not full PostgreSQL), and with PostgreSQL 17 server but pgAdmin shipping pg_dump 16.

**Sources:** [JetBrains DataGrip pg_dump issue #488](https://github.com/microsoft/azuredatastudio-postgresql/issues/488), [Bytebase pg_dump guide](https://www.bytebase.com/reference/postgres/how-to/how-to-install-pgdump-on-mac-ubuntu-centos-windows/) — MEDIUM confidence.

---

### Pitfall 9: The Single Zustand Store Is a Scalability Bottleneck

**What goes wrong:** The current `databaseStore.ts` is a single monolithic Zustand store with 40+ state slices managing connections, tabs, sidebar state, UI modals, query history, column visibility, filters, sort config, and more. Every `set()` call triggers re-renders in all subscribed components, regardless of which slice changed.

**Why it happens:** Zustand slices are not isolated by default. Without explicit selectors, `useStore()` subscribes to the entire state object.

**Consequences:**
- As tab count grows (10+ tabs, each with filter state, sort config, column visibility, row data), every keystroke in one editor causes re-renders in other tabs' components.
- The `tabs: any[][]` row data is stored in Zustand in-memory. With 20 open tabs each having 100 rows and 50 columns, this is megabytes of JS heap held live permanently.
- `updateTab` is called on every streaming batch, causing O(tabs) traversals for every received row batch.

**Prevention:**
1. Split the store into functional slices: `connectionSlice`, `tabSlice`, `uiSlice`, `historySlice`.
2. Use granular selectors everywhere: `useStore(s => s.tabs.find(t => t.id === activeTabId))` not `useStore(s => s)`.
3. Do not store result set row data in Zustand. Store it in a separate Map (by tab ID) managed outside the store, or use a `useRef` inside the tab component.
4. Cap query history at 100 items (already done) and tabs at a reasonable limit (20 suggested).

**Detection:** Open 10 tabs, each with 100 rows, and profile with React DevTools. Observe how many components re-render when typing in one editor.

**Sources:** [Zustand GitHub Discussion #1773 (large state / OOM)](https://github.com/pmndrs/zustand/discussions/1773), [Zustand GitHub Discussion #2540 (memory leak)](https://github.com/pmndrs/zustand/discussions/2540) — MEDIUM confidence.

---

### Pitfall 10: Schema Introspection Cache Goes Stale Without Invalidation

**What goes wrong:** The sidebar loads schema objects (tables, views, functions) once when a connection is established or when `refreshSidebar()` is called. If another user or process creates/drops a table on the connected database, the sidebar shows stale data. Autocomplete suggestions are seeded from this stale cache.

**Why it happens:** There is no server-push notification mechanism for schema changes in PostgreSQL (without `LISTEN/NOTIFY` subscriptions), MySQL, or SQLite. Changes are invisible until an explicit refresh.

**Consequences:**
- Autocomplete suggests dropped tables, causing query errors.
- Structure editor shows stale column definitions.
- Multi-user environments (shared dev databases) will frequently hit this.

**Prevention:**
1. Auto-refresh the sidebar after every DDL statement executed in the query editor (detect `CREATE`, `DROP`, `ALTER` keywords in the executed SQL).
2. Add a configurable auto-refresh interval (e.g., 30 seconds) that the user can enable for shared databases.
3. For PostgreSQL, consider `LISTEN` on pg_catalog change notifications.
4. Cache per-connection, not globally. Each connection must have its own schema snapshot.

**Detection:** Create a table from one psql session, observe whether the SQLMate sidebar shows the new table without manual refresh.

**Sources:** [DataGrip smart refresh announcement](https://datagrip1.rssing.com/chan-58271495/latest.php), [DBeaver SQL Assist documentation](https://dbeaver.com/docs/dbeaver/SQL-Assist-and-Auto-Complete/) — MEDIUM confidence.

---

### Pitfall 11: Chart Rendering Performance Degrades Severely Past ~5,000 Rows

**What goes wrong:** SVG-based chart libraries (Recharts is the most common choice with React) create one DOM node per data point. A scatter chart with 50,000 points crashes the browser tab. Even at 10,000 rows, Recharts is reported as "slow" in its own GitHub issues.

**Why it happens:** SVG is a retained-mode rendering model. Each data point becomes a DOM element tracked by the browser's layout engine.

**Consequences:**
- Metrics dashboards that query time-series data (e.g., 30 days of hourly data = 720 points per metric) appear fine in development but freeze with real production data volumes.
- Users with large databases who query a week of per-minute data (10,080 rows) will get a frozen UI.

**Prevention:**
1. Implement server-side data decimation (LTTB algorithm or simple time-bucket grouping) before returning chart data to the frontend. Never send raw rows to the chart component.
2. Use Canvas-based renderers (uPlot, ECharts with canvas mode, or Plotly.js) for time-series and scatter charts. ECharts handles 100,000+ points without browser freeze.
3. Set hard limits on chart data points (e.g., 2,000 max) and inform the user when data was downsampled.

**Detection:** Build a line chart querying a time-series table with 50,000 rows and observe browser frame rate.

**Sources:** [Recharts large data issue #1146](https://github.com/recharts/recharts/issues/1146), [Recharts scatter plot discussion #3181](https://github.com/recharts/recharts/discussions/3181) — HIGH confidence, direct maintainer acknowledgment.

---

## Minor Pitfalls

### Pitfall 12: react-window / TanStack Virtual Requires Fixed Row Heights

**What goes wrong:** Both `react-window` and `@tanstack/react-virtual` (already in dependencies) require knowing the height of each row before rendering to calculate scroll position. If row content is variable-height (wrapping text, multi-line values, JSON preview mode), the virtualization breaks: rows overlap, scroll position jumps, and the list shows blank areas.

**Prevention:** Default to fixed row height (36px or 40px) for all data table views. For "expanded row" detail views, exit virtualization and render a normal list with a row count cap (< 200 rows).

**Sources:** [react-window dynamic height issue #190](https://github.com/bvaughn/react-window/issues/190) — HIGH confidence.

---

### Pitfall 13: BLOB / Binary Column Display Without Size Guards Causes Memory Spikes

**What goes wrong:** When a table contains a `BYTEA` (PostgreSQL), `BLOB` (MySQL), or `BLOB` (SQLite) column with large binary values (images, documents), fetching 100 rows can load hundreds of MB into JS heap. The current `postgres_row_to_values!` macro in `query_engine.rs` serializes all column types to `serde_json::Value`.

**Prevention:**
1. Detect binary column types during schema introspection.
2. For binary columns, return a placeholder string (`<BLOB: 1.2 MB>`) rather than the raw bytes.
3. Allow downloading/viewing binary data only on explicit user request per-cell.

**Sources:** Code inspection + [sqlx BLOB handling issue #3390](https://github.com/launchbadge/sqlx/issues/3390) — MEDIUM confidence.

---

### Pitfall 14: SQL Dialect-Specific Wrapping in `wrap_pagination` and `wrap_count` Can Fail

**What goes wrong:** The current `wrap_pagination` and `wrap_count` helpers wrap any `SELECT` in a subquery using `AS __sqlmate_q`. This breaks on:
- CTEs: `WITH x AS (...) SELECT ...` — the outer wrap creates invalid SQL in some engines.
- `SELECT INTO` (SQL Server / PostgreSQL extension).
- MySQL `LIMIT` within subqueries (requires an alias but no `AS` keyword in older MySQL versions).
- Views and stored procedures that return result sets.

**Prevention:**
1. Parse the SQL before wrapping (even a simple regex-based check for `WITH` at the start) to decide if wrapping is safe.
2. For CTEs, either incorporate the pagination clause into the inner CTE or use `FETCH NEXT N ROWS ONLY` (ANSI SQL:2008 standard supported by most engines).
3. Test pagination against every supported engine with CTE queries.

**Sources:** Code inspection of `query_engine.rs` — HIGH confidence based on direct reading.

---

### Pitfall 15: Passwords Are Transmitted in Plaintext in Connection URL Strings

**What goes wrong:** In `test_connection` (and historically in `connect_postgres/connect_mysql`), the password is interpolated directly into a URL string: `postgres://user:password@host:port/db`. URL-encoded passwords with special characters (`@`, `:`, `#`, `%`) will cause connection failures or be truncated.

**Prevention:**
1. Always use `PgConnectOptions` / `MySqlConnectOptions` builder methods (already done in `connect_postgres` and `connect_mysql`) — do NOT use URL string interpolation for production connections.
2. Fix `test_connection` to use the options builder pattern, not the URL format. The current `test_connection` implementation still uses string URL interpolation.

**Sources:** Code inspection of `connection_manager.rs` lines 83-110 — HIGH confidence based on direct reading.

---

### Pitfall 16: `wrap_pagination` Uses `SELECT *` Around User's Query, Defeating Index Hints

**What goes wrong:** `SELECT * FROM (user_query) AS __sqlmate_q LIMIT N OFFSET N` prevents the database optimizer from pushing the `LIMIT` into the inner query. For queries with `ORDER BY` on indexed columns, this means fetching all rows into a temporary result set before applying the limit.

**Prevention:** Detect if the user's query already ends with `LIMIT N` and skip wrapping. For simple `SELECT * FROM table` queries generated by the table view, use `SELECT * FROM table LIMIT ? OFFSET ?` directly (not a subquery wrap).

**Sources:** Code inspection — MEDIUM confidence.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Adding new DB engines | Feature matrix explosion; sqlx has no Oracle/Redis support | Build `DatabaseDriver` trait first; add engines one at a time with documented support matrix |
| SQL autocomplete | Monaco global completion provider bleeds between tabs | Implement single global provider keyed to active tab context |
| Backup/Restore | Missing/mismatched pg_dump binary on Windows | Detect binary at connection time; allow user config of binary path |
| Metrics dashboards | SVG chart collapses at >5K data points | Pre-aggregate in Rust; use canvas-based renderer |
| User management | Dialect differences (GRANT syntax, role model) are substantial | Implement per-engine user management queries; do not share code between engines |
| localStorage migration | Existing user data will be silently lost | Implement migration-on-first-launch before any other storage changes |
| SSH tunneling | libssh2 thread safety; blocking forever on disconnect | Add keepalive + shutdown signal to tunnel tasks |
| Table structure editing | DDL syntax varies by engine and version | Parse DDL round-trip; test ALTER TABLE against every engine |
| BLOB/binary data | Memory spike fetching blob-heavy tables | Detect binary columns; return placeholders by default |
| Multi-tab state | Zustand monolith causes cross-tab re-renders | Split store; never store row data in Zustand |

---

## Sources

- [RUSTSEC-2024-0363 Advisory](https://rustsec.org/advisories/RUSTSEC-2024-0363.html)
- [Tauri IPC Performance Discussion](https://github.com/tauri-apps/tauri/discussions/11915)
- [Tauri IPC Raw Binary Issue](https://github.com/tauri-apps/tauri/issues/7127)
- [Tauri localStorage Bug (macOS)](https://github.com/tauri-apps/tauri/issues/4455)
- [Tauri Store Plugin Documentation](https://v2.tauri.app/plugin/store/)
- [Aptabase: Persistent State in Tauri Apps](https://aptabase.com/blog/persistent-state-tauri-apps)
- [Monaco Editor: Completion Provider Per-Instance Issue #593](https://github.com/microsoft/monaco-editor/issues/593)
- [Monaco Editor: Multiple Instances Issue #2792](https://github.com/microsoft/monaco-editor/issues/2792)
- [monaco-sql-languages (DTStack)](https://github.com/DTStack/monaco-sql-languages)
- [libssh2 Thread Safety](https://libssh2-devel.cool.haxx.narkive.com/uc4DbQEq/libssh2-thread-safety)
- [libssh2 Blocking Forever Issue #105](https://github.com/libssh2/libssh2/issues/105)
- [keyring-rs GitHub](https://github.com/hwchen/keyring-rs)
- [Recharts Large Data Issue #1146](https://github.com/recharts/recharts/issues/1146)
- [Recharts Scatter Plot Discussion #3181](https://github.com/recharts/recharts/discussions/3181)
- [sqlx Cross-Engine Code Sharing Discussion](https://github.com/launchbadge/sqlx/discussions/4030)
- [sqlx MySQL UUID Binary Format Note](https://docs.rs/sqlx/latest/sqlx/mysql/types/index.html)
- [Zustand Large State OOM Discussion](https://github.com/pmndrs/zustand/discussions/1773)
- [react-window Dynamic Height Issue #190](https://github.com/bvaughn/react-window/issues/190)
- [DataGrip Smart Refresh Announcement](https://datagrip1.rssing.com/chan-58271495/latest.php)
- [JetBrains pg_dump Version Mismatch Issue #488](https://github.com/microsoft/azuredatastudio-postgresql/issues/488)
- [Bytebase pg_dump Cross-Platform Guide](https://www.bytebase.com/reference/postgres/how-to/how-to-install-pgdump-on-mac-ubuntu-centos-windows/)
- [Bytebase SQL Autocomplete with ANTLR4](https://www.bytebase.com/blog/sql-auto-complete/)
