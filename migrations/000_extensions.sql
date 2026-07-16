-- 000_extensions.sql
-- Enables gen_random_uuid(), used as the default for every primary key
-- in this schema. UUIDs (over auto-incrementing integers) are used
-- deliberately: they don't leak information about row counts or ordering
-- across stores, which matters once many different retail businesses
-- share this database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
