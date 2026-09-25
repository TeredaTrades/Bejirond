# Multi-user book/ledger sharing — scoping doc

Written 2026-09-25 to close the "backend for team/cross-device sharing"
open item first flagged in `PROJECT_LOG.md` (2026-08-19). Nothing here
is implemented yet — this is the plan to build against.

## Goal

Let two or more people, each on their own phone, view and/or edit the
same book/ledger, with the existing role model (Primary Admin / Book
Admin / Data Operator / Viewer) actually enforced instead of simulated
locally.

## Non-negotiable constraint

Solo users, and any book that is never shared, must stay exactly as
they are today: fully offline, no account, nothing leaves the phone.
Sync only switches on for a specific book the moment someone taps
"Share this book." This is what keeps "your data never leaves your
phone" true for the majority of users who never share anything.

## Chosen approach

Supabase (Postgres + Auth + Row-Level Security). Follows the one
existing precedent in this project family — ገበያ (Gebeya) already uses
Supabase for its listings table + RLS. Recommend a **new, standalone**
Supabase project for Bejirond rather than reusing the articles-CMS
one — different app, different security boundary, no reason to share
a database.

Not chosen: Firebase (the other option named back in August) — no
strong reason to prefer it over Supabase here, and Supabase keeps the
project family consistent.

## Data model (Postgres)

- `users` — via Supabase Auth, not a custom table
- `books` (id, name, currency, created_by, created_at)
- `book_members` (book_id, user_id, role, invited_by, status:
  pending/active, created_at) — PK (book_id, user_id)
- `entries` (id, book_id, ...existing local entry fields, created_by,
  updated_at, updated_by)
- `activity_log` (book_id, actor_id, action, params, created_at) —
  mirrors the existing local `logActivity`

RLS policies, roughly:
- `book_members`: a user can see their own membership row, and every
  membership row for a book where they are Book Admin or Primary Admin
- `entries`: read allowed for any role in `book_members` for that
  book; write allowed for Data Operator and above; member management
  and book deletion restricted to Book Admin / Primary Admin

## Client-side changes (`src/App.jsx`)

1. **"Share this book"** action in Book Settings — converts a
   local-only book into a synced one: creates the `books` row, a
   `book_members` row for the current user as Primary Admin, and
   uploads existing local entries as the seed.
2. **Real `AddMemberScreen`** — replace the current fake local-only
   add with an actual invite (invite code/link, or phone lookup if
   phone auth is used), writing a `pending` `book_members` row instead
   of just a local object.
3. **Data-layer split** — `getEntries`/`saveEntries`/`persistLedgers`
   currently only touch `storeGet`/`storeSet` (local). Add a thin sync
   layer: local-only books are untouched; synced books write to a
   local pending-sync queue and attempt an immediate push to Supabase,
   and reads merge the local cache with the latest pulled remote state.
4. **Getting updates from other members** — Supabase Realtime
   subscription on `entries`/`book_members` for the currently open
   synced book for v1-plus; for the simplest v1, a pull-on-open +
   manual refresh is enough to ship first.
5. **Conflict handling, v1** — last-write-wins per entry using
   `updated_at`. Simple, not perfect; log as a known simplification
   rather than building per-field merge up front.
6. **Auth UI** — a sign-in screen (phone or email) that only appears
   the moment someone shares a book or accepts an invite to someone
   else's book. Nobody else ever sees it.
7. **Offline queue** — local writes to a synced book get a
   `pendingSync: true` flag; a background flush pushes the queue in
   order once connectivity returns, so editing offline still works
   even on a shared book.

## Migration for existing users

None needed. Existing local ledgers stay local-only until someone
explicitly shares them; at that point their current entries become the
seed data for the new cloud record.

## Phased rollout

- **Phase 1** — Expense Manager ledgers only; core create/read/update
  sync; invite by code (no push notifications); last-write-wins;
  pull-on-open instead of realtime.
- **Phase 2** — Realtime updates, push notifications on new entries,
  invite by phone lookup.
- **Phase 3** — Per-field conflict merge, the standalone "simpler ways
  to add members" UX item, full activity log surfaced to Book Admins.

## Infra / cost

Supabase's free tier (500MB DB, 50k monthly active Auth users) is very
likely enough through launch. A Supabase project gets its own
`<project>.supabase.co` URL — **no dependency on the `bejirond.app`
domain question**, which is a separate hosting/branding decision for
the PWA and landing page only.

## Build order

1. Supabase project + schema + RLS policies
2. Auth screens, gated behind the sharing action only
3. "Share this book" flow + seed upload
4. Real `AddMemberScreen` (invite-by-code)
5. Sync layer: push/pull, pending queue, last-write-wins
6. Test with two physical devices editing the same book concurrently
7. Later: realtime, push notifications, per-field merge
