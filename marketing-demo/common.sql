CREATE TABLE users (
    id bigint PRIMARY KEY,
    full_name varchar(100) NOT NULL,
    email varchar(160) NOT NULL UNIQUE,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id bigint PRIMARY KEY,
    sku varchar(32) NOT NULL UNIQUE,
    name varchar(120) NOT NULL,
    price numeric(10, 2) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active'
);

CREATE TABLE orders (
    id bigint PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id),
    status varchar(20) NOT NULL DEFAULT 'new',
    total numeric(10, 2) NOT NULL,
    placed_at timestamp NOT NULL
);

CREATE TABLE order_items (
    id bigint PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders(id),
    product_id bigint NOT NULL REFERENCES products(id),
    quantity integer NOT NULL,
    unit_price numeric(10, 2) NOT NULL
);

INSERT INTO users (id, full_name, email, created_at) VALUES
    (1, 'Maya Chen', 'maya@example.test', '2026-01-02 10:00:00'),
    (2, 'Noah Patel', 'noah@example.test', '2026-01-03 10:00:00'),
    (3, 'Ava Rivera', 'ava@example.test', '2026-01-04 10:00:00'),
    (4, 'Leo Brooks', 'leo@example.test', '2026-01-05 10:00:00');

INSERT INTO products (id, sku, name, price, status) VALUES
    (101, 'DESK-001', 'Walnut desk lamp', 49.00, 'active'),
    (102, 'NOTE-002', 'Grid notebook', 12.50, 'active'),
    (103, 'MUG-003', 'Ceramic coffee mug', 18.00, 'active'),
    (104, 'PEN-004', 'Brass pen', 24.00, 'active');

INSERT INTO orders (id, user_id, status, total, placed_at) VALUES
    (1001, 1, 'delivered', 61.50, '2026-02-01 09:30:00'),
    (1002, 2, 'packed', 18.00, '2026-02-02 11:45:00');

INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES
    (5001, 1001, 101, 1, 49.00),
    (5002, 1001, 102, 1, 12.50),
    (5003, 1002, 103, 1, 18.00);
