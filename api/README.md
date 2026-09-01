# ArthurIQ Backend API — Phases 2 & 3

The core API (Phase 2): endpoints for every action ArthurIQ.jsx
currently performs locally, plus the reorder-recommendation math moved
server-side. Authentication (Phase 3): real login, hashed passwords, and
sessions — replacing Phase 2's temporary `X-Store-Id` header placeholder.

## Authentication — how it actually works right now

There is **no self-serve signup and no payment integration** — that was
deliberately deferred (see the conversation this was built from) so
pilot testing could start sooner. Instead:

1. Someone on the ArthurIQ team runs `scripts/createPilotAccount.js` to
   create a new store + owner account directly in the database. It
   prints a temporary password to the console.
2. That temporary password gets relayed to the pilot store owner over a
   channel you already trust (phone call, text) — **never email**, and
   never something that sits around in plain text indefinitely.
3. The owner logs in with `POST /api/auth/login`. The response includes
   `mustChangePassword: true`, telling the frontend to force a password
   change before anything else.
4. `POST /api/auth/change-password` sets their real password (hashed,
   never seen by us) and invalidates every existing session for that
   account — including the one used to make this exact request — issuing
   a fresh token so the current device stays logged in.
5. From then on, it's normal login/logout via `/api/auth/login` and
   `/api/auth/logout`.

Every other endpoint now requires a valid session token, sent as
`Authorization: Bearer <token>`, instead of Phase 2's `X-Store-Id`
header. No route handler outside of `routes/auth.js` needed to change —
they only ever read `req.storeId`, and never knew or cared how it got
set.

**What's still explicitly deferred**: automated self-serve signup,
payment processing, transactional email (password reset via email isn't
built — for now, a new temporary password would need to be issued
manually via the same script, same as initial onboarding), and
permission *enforcement* for the owner/staff role distinction (the
`role` column exists on `users`, but nothing in the app currently has
owner-only data to protect, so there's nothing to enforce yet).

## Running it locally

1. Have a PostgreSQL database with all of Phase 1's migrations
   (000–007) *and* Phase 3's (008, 009) applied.
2. `cd api && npm install`
3. Copy `.env.example` to `.env` and fill in your real `DATABASE_URL`.
4. `node src/server.js`
5. Create a pilot account: `node scripts/createPilotAccount.js "Store Name" owner@example.com`

## Endpoints

| Method | Path | Requires auth? | Matches this frontend action |
|---|---|---|---|
| POST | `/api/auth/login` | No | Login screen |
| POST | `/api/auth/logout` | Yes | Log out |
| POST | `/api/auth/change-password` | Yes | Forced first-login password change, or a later voluntary change |
| GET | `/api/vendors` | Yes | Vendor dropdown in Add Style / Create PO |
| POST | `/api/vendors` | Yes | "+ New" vendor inline creation |
| GET | `/api/styles` | Yes | Shelf tab load — styles + variants + computed status |
| POST | `/api/styles` | Yes | AddStyleModal "Add to shelf" |
| PATCH | `/api/styles/:id` | Yes | EditStyleModal "Save changes" |
| DELETE | `/api/styles/:id` | Yes | "Remove style" (edit mode + confirm) |
| POST | `/api/styles/:styleId/variants` | Yes | Inline "Add variant" |
| PATCH | `/api/variants/:id` | Yes | EditVariantModal "Save changes" |
| DELETE | `/api/variants/:id` | Yes | "Remove variant" (edit mode + confirm) |
| POST | `/api/variants/:id/sales` | Yes | LogSaleModal "Log sale & update stock" |
| POST | `/api/variants/:id/adjust-stock` | Yes | AdjustStockModal "Add to stock" |
| GET | `/api/purchase-orders` | Yes | Purchase Orders tab load |
| POST | `/api/purchase-orders` | Yes | CreatePOModal "Save as draft" |
| POST | `/api/purchase-orders/:id/submit` | Yes | "Submit to vendor" |
| DELETE | `/api/purchase-orders/:id` | Yes | "Delete draft" (draft only) |
| POST | `/api/purchase-orders/:id/close` | Yes | "Close PO" |
| POST | `/api/purchase-orders/:id/receive` | Yes | "Receive shipment" |

## What was actually tested before delivering this

### Phase 2 (unchanged from before)
Full data lifecycle, full PO lifecycle (including capped over-receiving),
tenant isolation, delete protection, and input validation — all run
against a real disposable PostgreSQL instance. See git history / prior
delivery for full detail.

### Phase 3 (new)
- **Unauthenticated access is rejected**: no token at all, and a wrong
  password, both return clean 401s (with an identical, generic message
  for "unknown email" vs. "wrong password," so a failed login never
  reveals which one it was).
- **The full onboarding flow, end to end**: ran
  `createPilotAccount.js`, logged in with the printed temporary
  password, confirmed `mustChangePassword: true`, changed the password,
  confirmed the *old* temporary password no longer works and the new one
  does, with `mustChangePassword` correctly flipped to `false`.
- **A real security gap, found and fixed during testing**: the first
  version of `change-password` didn't invalidate the session token used
  to make that very request — meaning a token in place *before* a
  password change would keep working *after* it, defeating part of the
  point of changing a password in a suspected-compromise scenario. Fixed
  so changing a password deletes every existing session for that user
  and issues one fresh token, then re-verified: the pre-change token is
  now rejected immediately, and the newly issued one works.
- **Tenant isolation through real authenticated sessions** (not just
  Phase 2's header): created two separate pilot stores with two separate
  owner logins, had Store A create a vendor, and confirmed Store B's
  login sees an empty vendor list.
- **Logout actually revokes the session**: confirmed a token stops
  working immediately after logout, not just client-side.
- **Session expiry is enforced, and cleaned up**: manually backdated a
  session's expiry into the past, confirmed the request was rejected
  with a clear "session expired" message, and confirmed the expired
  session row was actually deleted from the database, not just ignored.
- **Duplicate email rejected**: attempting to create a second pilot
  account with an email already in use fails with a clear message
  instead of a raw database error.

## What's next

- **Permission enforcement** for owner vs. staff, whenever a real
  owner-only feature exists to protect (there isn't one yet).
- **Automated signup + payment integration**, if/when you're ready to
  move beyond manually onboarding pilot testers (see the earlier
  conversation this was scoped from).
- ~~Connect the frontend~~ — done. See the update below.

## Update: connecting the newer frontend (voice count + sales history editing)

A separate, more advanced version of `ArthurIQ.jsx` — with voice-based
stock counting and the ability to correct previously logged sales entries
— needed a few additions to connect to this backend:

- **`GET /api/store`** — returns the current session's store `{ id, name }`,
  so the app's header shows the real store name instead of a placeholder.
- **`PATCH /api/variants/:variantId/sales/:salesEntryId`** — corrects an
  existing sales entry (matches "Sales History" → "Edit"). Reconciles
  stock by the *change* in units, and re-validates the date range doesn't
  overlap any other entry for that variant, server-side.
- **Server-side overlap validation added to `POST /api/variants/:id/sales`
  too** — the original version only checked this on corrections; testing
  surfaced that a brand-new entry could still be logged with an
  overlapping range, since nothing blocked it going in the first time.
  Fixed so both paths are protected the same way.
- **`source: "voice"` support** on the sales-logging endpoint — voice
  count sessions log through this same endpoint as manual entries, just
  tagged differently, rather than needing a separate endpoint.
- **A real bug fix ported from the frontend**: `periodLengthDays` in
  `reorderLogic.js` was undercounting date ranges by one day (a Monday–
  Sunday period was counting as 6 days instead of 7). The newer frontend
  had already caught and fixed this client-side; the backend's copy of
  the same formula is now fixed to match, and the corrected rate was
  verified directly against a real logged sale (10 units over two
  periods totaling 11 inclusive days → rate 0.909, confirmed via the API).

All of the above was tested against a real, disposable PostgreSQL
instance and a real bundled build of the new frontend — not just
reviewed for correct syntax. That included the full login → forced
password change → real store name shown → style creation → sale logging
→ overlap rejection (both client-side warning and, separately, a direct
API-level check with the client-side check bypassed) → sales history
correction → confirming the correction persisted after a fresh fetch.
A second pilot account with a different store name was also created and
logged into, confirming the store name shown is genuinely the logged-in
store's own name and not a leftover hardcoded value.

