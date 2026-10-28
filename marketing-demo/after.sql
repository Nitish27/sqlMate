ALTER TABLE users ADD COLUMN preferred_name varchar(80);
ALTER TABLE products ALTER COLUMN price TYPE numeric(12, 2);
ALTER TABLE products ADD COLUMN stock_count integer NOT NULL DEFAULT 0;

CREATE TABLE product_reviews (
    id bigint PRIMARY KEY,
    product_id bigint NOT NULL REFERENCES products(id),
    rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
    summary varchar(160) NOT NULL
);

UPDATE users SET preferred_name = 'Maya' WHERE id = 1;
UPDATE products SET stock_count = 18 WHERE id = 101;
UPDATE products SET stock_count = 42 WHERE id = 102;
UPDATE products SET stock_count = 25 WHERE id = 103;
UPDATE products SET stock_count = 12 WHERE id = 104;
UPDATE orders SET status = 'shipped' WHERE id = 1002;

INSERT INTO product_reviews (id, product_id, rating, summary) VALUES
    (1, 101, 5, 'Warm light and a sturdy base');

INSERT INTO orders (id, user_id, status, total, placed_at) VALUES
    (1004, 4, 'new', 12.50, '2026-02-04 08:15:00');

INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES
    (5005, 1004, 102, 1, 12.50);
