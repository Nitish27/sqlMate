CREATE ROLE sqlmate_tester WITH LOGIN PASSWORD 'sqlmate-demo-only';
ALTER DATABASE sqlmate_lab OWNER TO sqlmate_tester;
CREATE DATABASE sqlmate_prod_sim OWNER sqlmate_tester;

\connect sqlmate_lab
SET ROLE sqlmate_tester;
CREATE TABLE session_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    label text NOT NULL,
    status text NOT NULL
);
INSERT INTO session_items (label, status) VALUES
    ('Welcome pack', 'queued'),
    ('Weekly report', 'ready'),
    ('Archive request', 'pending');
RESET ROLE;

\connect sqlmate_prod_sim
SET ROLE sqlmate_tester;
CREATE TABLE session_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    label text NOT NULL,
    status text NOT NULL
);
INSERT INTO session_items (label, status) VALUES
    ('Simulation only', 'pending'),
    ('No real customers', 'queued');
RESET ROLE;
