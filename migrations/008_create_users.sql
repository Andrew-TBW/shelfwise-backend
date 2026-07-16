-- 008_create_users.sql
--
-- One row per person who can log in. `role` is stored now (owner/staff)
-- so the column exists ahead of need, but no endpoint currently enforces
-- anything based on it — there's no owner-only data in the app yet
-- (e.g. no cost/report view to hide from staff). Enforcement gets added
-- when a real owner-only feature exists, not before.
--
-- email is globally unique (not scoped per-store): logging in starts
-- with "who are you," not "which store are you at" — the store_id comes
-- from the user row itself once we know who they are.
--
-- must_change_password supports the pilot onboarding flow: an account
-- created directly (by us, for a pilot store) starts with a temporary
-- password and this flag set true, forcing a real password to be chosen
-- on first login rather than an admin ever knowing the customer's actual
-- password long-term.

CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  email                 TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff')),
  must_change_password  BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_store_id ON users (store_id);

COMMENT ON TABLE users IS 'Login accounts. One store can have multiple users (owner + staff, later).';
