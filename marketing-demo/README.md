# Fictional Shop Demo

This isolated Docker fixture provides two PostgreSQL databases for safe sqlMate screenshots. All names, emails, and records are fictional. It does not connect to or copy any real database. The server is reachable only from this computer on `127.0.0.1:15433`, and its data lives in container tmpfs. Stopping the container discards it.

## Start

Run from the sqlMate repository root with Docker Desktop running:

```sh
docker compose -f marketing-demo/compose.yml up -d --wait
```

Add and open two PostgreSQL connections in sqlMate:

| Field | Before connection | After connection |
| --- | --- | --- |
| Name | `Demo Shop Before` | `Demo Shop After` |
| Host | `127.0.0.1` | `127.0.0.1` |
| Port | `15433` | `15433` |
| Username | `sqlmate_demo` | `sqlmate_demo` |
| Password | `sqlmate-demo-only` | `sqlmate-demo-only` |
| Database | `sqlmate_shop_before` | `sqlmate_shop_after` |

These credentials are public demo values. Never reuse them for another server. Leave both connections open for the comparison screens.

## Capture Guide

- **Schema Compare:** Choose `Demo Shop Before` as source and `Demo Shop After` as target. `users` and `products` have changed columns; `legacy_discounts` exists only before, and `product_reviews` only after.
- **Data Compare:** Load tables and select `orders`. The two sides share its exact schema. Order `1002` changed from `packed` to `shipped`; `1003` is source-only, and `1004` is target-only. The full three-row sample is within Data Compare's limit.
- **Relationship Map:** Open `orders` or `order_items`. Declared foreign keys connect `users`, `orders`, `order_items`, and `products`.
- **Quick Open and Inspect Value:** Search for `products` or `orders`, then inspect a cell with a full product name. Use only this fixture in marketing screenshots.

Before sharing a screenshot, crop out any unrelated tabs or connections that might show real database names or data.

## Verify Or Stop

```sh
docker compose -f marketing-demo/compose.yml exec -T postgres psql -U sqlmate_demo -d sqlmate_shop_before -c 'SELECT id, status FROM orders ORDER BY id;'
docker compose -f marketing-demo/compose.yml exec -T postgres psql -U sqlmate_demo -d sqlmate_shop_after -c 'SELECT id, status FROM orders ORDER BY id;'
docker compose -f marketing-demo/compose.yml down
```

To start again with the original records, run the start command. If port `15433` is occupied, change only the host-side port in `compose.yml` and both connection profiles.
