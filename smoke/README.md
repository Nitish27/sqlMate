# Cross-Engine Smoke Gate

This stack is for automated release checks, not the moderated [connection usability fixture](../usability/README.md). It starts disposable PostgreSQL 16 and MariaDB 10.11 databases with fake credentials. Both ports bind only to `127.0.0.1`, and database files live in container tmpfs.

From the repository root:

```sh
docker compose -f smoke/compose.yml up -d --wait
SQLMATE_SMOKE=1 cargo test --manifest-path src-tauri/Cargo.toml --test cross_engine_smoke -- --ignored
docker compose -f smoke/compose.yml down
```

The tests use only fixed loopback ports (`15433` for PostgreSQL, `13307` for MariaDB), database and user `sqlmate_smoke`, and the public fixture password `sqlmate-smoke-only`. They create uniquely named tables in those disposable databases. Never reuse these credentials for a real database. The tests are ignored by ordinary `cargo test` and require the explicit `SQLMATE_SMOKE=1` opt-in.

The [smoke-gate workflow](../.github/workflows/smoke-gate.yml) runs frontend tests, the production frontend build, Rust tests, and these cross-engine checks on pull requests and merges to `main`. Both release workflows require it to pass before building installers. SSH, TLS, notarization, and installed-app UI behavior remain separate release checks; this gate does not claim to cover them.
