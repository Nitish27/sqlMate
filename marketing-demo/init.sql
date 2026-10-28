CREATE ROLE sqlmate_demo WITH LOGIN PASSWORD 'sqlmate-demo-only';
CREATE DATABASE sqlmate_shop_before OWNER sqlmate_demo;
CREATE DATABASE sqlmate_shop_after OWNER sqlmate_demo;

\connect sqlmate_shop_before
SET ROLE sqlmate_demo;
\i /sqlmate-demo/common.sql
\i /sqlmate-demo/before.sql
RESET ROLE;

\connect sqlmate_shop_after
SET ROLE sqlmate_demo;
\i /sqlmate-demo/common.sql
\i /sqlmate-demo/after.sql
RESET ROLE;
