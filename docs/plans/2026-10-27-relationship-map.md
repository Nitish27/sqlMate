# Relationship Map

## Goal

Let a user inspect the selected table and its declared, one-hop foreign-key relationships without reading rows or changing schema. This is the second feature planned for the release alongside Schema Compare.

## Design

- Open a focused map from a table tab. The center table and directly referencing/referenced tables appear as cards joined by labeled arrows; composite keys stay grouped.
- Reuse the metadata-only schema snapshot for table/column cards. Add one backend command returning declared foreign keys for the selected database. PostgreSQL and MySQL/MariaDB use catalog queries; SQLite reads `foreign_key_list` for each table. No row queries or DDL.
- The frontend model filters all relationships to the selected table, distinguishes schema-qualified PostgreSQL tables, and identifies missing referenced tables. The view provides pan, zoom, search, and table navigation where the existing table browser can open the destination safely.
- Show a clear empty state when there are no declared relationships. Errors and connection/database changes invalidate the view. No inferred links, editing, export, or whole-database layout in this slice.

## Plan

### Task 1: Relationship metadata

**Files:** Add `src-tauri/src/core/relationships.rs`; modify `src-tauri/src/core/mod.rs`, `src-tauri/src/lib.rs`, and `src-tauri/tests/cross_engine_smoke.rs`.

**Action:** Return grouped, ordered source/target column pairs with source and target schema. Reuse the connection manager pools and quote SQLite identifiers. Do not query rows or infer relationships from column names.

**Verify:** `cargo test --manifest-path src-tauri/Cargo.toml` and the disposable PostgreSQL/MariaDB smoke test. A SQLite unit test must cover composite foreign keys and a referenced key omitted from `REFERENCES`.

**Done:** All three engines return declared edges in source/target order, including composite keys, with no row read/write.

### Task 2: Focused graph model

**Files:** Add `src/utils/relationshipMap.ts` and `scripts/relationship-map.test.mjs`.

**Action:** Build a one-hop, schema-aware graph from a snapshot and relationship list. Keep missing referenced tables visible but non-navigable. Never merge same-name tables from different PostgreSQL schemas.

**Verify:** `node --test scripts/relationship-map.test.mjs`.

**Done:** Outgoing, incoming, composite, duplicate-schema-name, and empty cases pass.

### Task 3: Map UI

**Files:** Add `src/components/RelationshipMapDialog.tsx`; modify `src/components/TabContentTable.tsx`, `src/components/TableFooter.tsx`, and `README.md`.

**Action:** Open from the table footer; load metadata, display a pan/zoom graph with a search field and accessible card actions. Prevent navigation to an unsupported PostgreSQL schema or missing table. Show loading/errors/empty states.

**Verify:** `npm test`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `git diff --check`.

**Done:** The map is read-only, table navigation uses existing tabs, and the full verification suite passes.
