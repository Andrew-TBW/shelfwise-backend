-- 010_create_report_recipients.sql
--
-- Email addresses that should receive automated reports (starting with
-- the Weekly Report) for a store. Deliberately just email + store_id —
-- no "name" or "role" field, since nothing in the app currently needs
-- to distinguish who a recipient is, just where to send the report.
--
-- This table is useful on its own before any actual email-sending code
-- exists: it lets a store owner set up who *should* receive reports now,
-- ahead of the send pipeline itself being built once a real email
-- provider is chosen (see Backend Build Plan for that future phase).

CREATE TABLE report_recipients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, email)
);

CREATE INDEX idx_report_recipients_store_id ON report_recipients (store_id);

COMMENT ON TABLE report_recipients IS 'Email addresses that receive automated reports for a store (e.g. the Weekly Report).';
