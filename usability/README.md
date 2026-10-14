# Connection Usability Fixture

Use this fixture only for moderated sqlMate sessions. It starts one PostgreSQL container with two fake databases, `sqlmate_lab` and `sqlmate_prod_sim`. Both are bound to `127.0.0.1:15432`; they are **not** production systems. The second name exists so a participant can try a connection tagged `production` without touching production data. The tag is user-assigned and does not verify the server.

## Start

Docker Desktop must be running. From the sqlMate repository root:

```sh
docker compose -f usability/compose.yml up -d --wait
```

Use a separate macOS user account or test machine for sqlMate sessions. Do not clear your personal sqlMate workspace or OS keychain to simulate a new user.

Connection card for both databases:

| Field | Value |
| --- | --- |
| Driver | PostgreSQL |
| Host | `127.0.0.1` |
| Port | `15432` |
| User | `sqlmate_tester` |
| Correct password | `sqlmate-demo-only` |
| Database A | `sqlmate_lab` |
| Database B | `sqlmate_prod_sim` |

The moderator should first give the participant `incorrect-demo-password`, then provide the correct password after the participant has interpreted the connection error. These are public, fake credentials for this fixture only. Never reuse them for another database.

Verify the fixture before a session:

```sh
psql -h 127.0.0.1 -p 15432 -U sqlmate_tester -d sqlmate_lab -c 'SELECT id, label, status FROM session_items;'
```

Enter `sqlmate-demo-only` when prompted. The query should return three rows. See [moderator-script.md](moderator-script.md) for the session tasks.

## Reset Or Stop

To start each session with fresh data, stop and start this fixture:

```sh
docker compose -f usability/compose.yml down
docker compose -f usability/compose.yml up -d --wait
```

The database lives only in container tmpfs, so stopping the container discards its data. This does not erase sqlMate's saved connections, drafts, or OS-keychain entries; use a dedicated OS profile for those. To stop after the final session, run `docker compose -f usability/compose.yml down`.

If port `15432` is already in use, change only the host-side port in `compose.yml` and on the participant connection card. SSH and TLS are deliberately out of scope for this first fixture; test them later with a separate disposable endpoint if participants use them.
