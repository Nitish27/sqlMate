ALTER TABLE users ADD COLUMN phone_number varchar(24);
ALTER TABLE products ADD COLUMN legacy_category varchar(40);

CREATE TABLE legacy_discounts (
    id bigint PRIMARY KEY,
    code varchar(32) NOT NULL UNIQUE,
    percent_off integer NOT NULL
);

UPDATE users SET phone_number = '555-0101' WHERE id = 1;
UPDATE products SET legacy_category = 'Lighting' WHERE id = 101;

INSERT INTO legacy_discounts (id, code, percent_off) VALUES
    (1, 'WELCOME10', 10);

INSERT INTO orders (id, user_id, status, total, placed_at) VALUES
    (1003, 3, 'new', 24.00, '2026-02-03 14:20:00');

INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES
    (5004, 1003, 104, 1, 24.00);
