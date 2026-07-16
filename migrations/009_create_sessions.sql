-- 009_create_sessions.sql
--
-- A session is an explicit row, not a self-contained signed token (like
-- a JWT would be). That's a deliberate choice for this stage: it means
-- "log this device out" is a real DELETE statement, not something that
-- requires a separate revocation/blocklist system on top of an
-- otherwise-stateless token. At this scale (a handful of pilot stores),
-- the extra database lookup per request costs nothing meaningful.
--
-- store_id is duplicated here (also derivable via user_id -> users.store_id)
-- for the same reason it's duplicated on variants/sales_entries/etc. in
-- Phase 1: every authenticated request can filter directly on
-- sessions.store_id without an extra join.

CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT NOT NULL UNIQUE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

COMMENT ON TABLE sessions IS 'Active logins. A row here is a valid token; deleting it logs that device out immediately.';
