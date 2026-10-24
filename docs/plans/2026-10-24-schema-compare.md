# Schema Compare: first slice

## Goal and scope

Help users see table and column drift between two currently connected databases of the same engine. The comparison is read-only and does not fetch row data, generate migration SQL, or mutate either connection. Saved but disconnected connections must be opened before selection so credential prompts and network failures remain in the existing connection flow.

## Design

- A toolbar action opens a comparison workspace. Source defaults to the active connection; target is another open connection of the same engine. The selected databases are shown prominently and can be swapped.
- Rust returns one metadata-only snapshot per connection. PostgreSQL uses schema-qualified table identities and exact formatted types; MySQL/MariaDB uses the selected database's information schema; SQLite uses main-schema tables and `table_xinfo` for columns. Tables without columns remain visible.
- A pure frontend comparator matches schema/table and column names, then reports added, removed, and changed columns (type, nullability, default, primary key). It distinguishes unchanged tables and never claims an automatic migration is safe.
- The UI shows a searchable summary and side-by-side column details. A failed snapshot leaves no partial diff and offers retry. A selection change discards prior results. All labels are escaped by React.

## Risks and boundaries

- PostgreSQL schemas with equal table names must not collide; use schema-qualified identity.
- Different engine types must be rejected before requesting metadata. Cross-engine normalization, index/constraint diffing, data comparison, and automatic sync are deferred.
- Snapshot queries may be slow on very large SQLite databases; show loading and allow closing the view. No row contents or credentials are sent to the comparison code.

## Implementation plan

1. **Metadata snapshot:** add `src-tauri/src/core/schema_snapshot.rs`, register `get_schema_snapshot` in `src-tauri/src/lib.rs`, and add a SQLite integration test. Verify with `cargo test --manifest-path src-tauri/Cargo.toml schema_snapshot`.
2. **Pure diff:** add `src/utils/schemaCompare.ts` and `scripts/schema-compare.test.mjs`, including same-name/different-schema, added/removed/changed columns, and comparison direction. Verify with `node --test scripts/schema-compare.test.mjs`.
3. **Interaction:** add a read-only comparison view and toolbar entry point, guarding same-engine/open connections and stale results. Verify with `npm test`, `npm run build`, and the Rust test suite.
