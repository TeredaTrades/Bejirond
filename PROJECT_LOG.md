# በጅሮንድ (Bejirond) — decision log

## 2026-09-28 — Addendum to the sync/push work: decisions, rationale, verification

Companion to the 2026-09-25-to-27 entry below (which records *what* was
built). This one records the decisions made along the way and why, what was
verified afterward, and the known gaps going into real-device testing.

### Design decisions and why

- **The shared unit is the ledger (business), not an individual cash book.**
  Members and roles already live at the ledger level in this app, and a
  ledger holds several local cash books. So one `books` row in Supabase
  represents one *ledger*; its list of local cash books is stored in
  `books_meta`, and every synced entry's JSON carries a `localBookId` so a
  joining device can sort entries back into the right local book. This
  differs from the wording in `docs/MULTI_USER_SYNC_SCOPE.md`, which treated
  "book" as the unit; the code follows the app's real structure and the
  scoping doc was not rewritten.
- **Invite-by-code, not invite-by-email.** The client must never hold a
  service-role key, and there is no server to look users up by email. The
  invite row's UUID *is* the code (single use, expires after 7 days), and a
  `security definer` function `redeem_invite()` does the membership insert
  server-side. Simplest design that needs no extra infrastructure.
- **Email/password auth, not phone.** Phone sign-in needs a paid SMS
  provider; email is free. Supabase's "Confirm email" was left at its
  default (on), so a new account must click the confirmation link before
  its first sign-in. Flip it off in the dashboard if that friction gets in
  the way of testing.
- **Last-write-wins, no per-field merge.** Only bites if two people edit the
  *exact same entry* within seconds of each other — rare for a small team's
  expense book, and per-field merge is real engineering. Deliberately
  deferred in favor of notifications.
- **Credentials live in `.env.production`, committed on purpose.** The
  publishable key is designed to be public (RLS is the protection), and the
  session's GitHub token could not write Actions secrets anyway. This means
  both CI builds (APK and Pages) pick the config up with no extra setup.
- **Firebase on the free Spark plan; Analytics left off.** FCM is free and
  unlimited on Spark and Blaze alike, and the server logic runs on Supabase
  Edge Functions, not Firebase, so nothing here needs a paid tier. Analytics
  isn't needed for per-member pushes (it only powers behavioral audience
  targeting, A/B tests, etc.). It can be enabled later from Project
  Settings > Integrations. If it ever is, mention it in a privacy policy,
  since the app's pitch to solo users is that their data never leaves the
  phone.
- **A custom domain is not needed for any of this, and was not bought.**
  The app still lives at `teredatrades.github.io/Bejirond/` (no `CNAME`
  anywhere). The plan on record is `bejirond.app` for the landing page and
  `app.bejirond.app` for the PWA. Reasoning: sync and push use the Supabase
  project's own `*.supabase.co` URL, so the two are fully independent. The
  domain is worth having before a public/Play Store push (a store listing
  wants a real site and privacy-policy URL, links stop depending on GitHub
  hosting, and it reads as more trustworthy at the moment someone installs a
  finance app), but nothing is blocked on it. Moving later costs one config
  change: add the new site URL to Supabase Auth's allowed URL list.

### Verified 2026-09-28

- Latest GitHub Release `build-main-127` (`Bejirond.apk`, ~6.6 MB, not a
  prerelease) is built from `40c4874`, which is the head of `main`. It
  includes `google-services.json` and all sync/push code. The download
  page's button goes through the `bejirond-dl` Cloudflare worker to the
  latest release.
- GitHub Pages reports `built` on the same commit; the deployed bundle
  contains the Supabase project config; the PWA manifest is standalone with
  192/512 icons and a registered service worker.
- The chat sandbox's network proxy blocks `*.github.io`, so the live PWA
  page itself was NOT loaded from here; it was checked through the GitHub
  Pages API and the repo contents instead.

### Known gaps going into real-device testing

- **Nothing has been tested on a real second device.** The `notify-entry`
  function has never actually been invoked; the first real test is also its
  first real run. If no notification arrives, check the function's Logs tab
  in Supabase.
- **Push is native-only.** The PWA gets sharing and live updates while a
  book is open, but no background notifications.
- **The trigger fires on INSERT only**, so editing an existing entry does
  not notify anyone.
- **Authorship fields aren't stable.** Every save upserts the whole book, and
  that overwrites `created_by`/`updated_by` with whoever pushed last.
  Harmless today; worth fixing before anything relies on "who added this".
- **Android 13+ needs the notification permission granted** on the receiving
  phone, or the token registers but nothing displays.
- The trigger function in the database has the function URL and shared
  secret baked in (see the 2026-09-25-to-27 entry for why); they are not in
  git, and `004_push_notifications.sql` carries placeholders. The secret was
  generated in chat, so rotate it (function secret and trigger function
  together) if that matters.

### Test plan

Install the latest APK on two phones, sign in on both, accept the
notification prompt. Share a business from one, generate an invite code,
join from the other. Close the app on the second phone, then log an entry on
the first and see whether a notification lands.

## 2026-09-25 to 27 — Multi-user book/ledger sync (Phases 1–2) + push notifications

**The ask:** let two or more people, each on their own phone, view and
edit the same business/ledger — closing the gap where "Business Team"
roles were purely a local, single-device simulation with no real
cross-device access behind them.

**Scoping (`docs/MULTI_USER_SYNC_SCOPE.md`, `b6efcdf`):** Supabase
(Postgres + Auth + RLS), sync opt-in per ledger so solo/unshared
businesses stay fully offline exactly as before — nothing changes for
anyone who never shares. A brand-new dedicated Supabase project
(`bejirond-sync`, ref `isiwxmahjmtfvejebevu`, under the existing
TeredaTrades Org — isolation is per-project, not per-org, so sharing
the org was fine) rather than reusing `teredatrades-auth`, for a clean
security boundary from the unrelated articles-CMS data.

**Phase 1 — share / invite / join (`800b5ef`, `7e56f78`, `e5add20`):**
- Schema: `books` / `book_members` / `entries` / `activity_log`, RLS
  matching the existing Primary Admin / Book Admin / Data Operator /
  Viewer roles (`001_multi_user_sync.sql`)
- Invite-by-code: an `invites` table + `redeem_invite()` RPC — the
  invite id itself is the code, redeemable once, expires in 7 days
  (`002_invites_and_books_meta.sql`)
- Client: `src/supabaseClient.js` (no-ops with no env vars — sync stays
  fully optional), `src/cloudSync.js` (email auth, `shareLedger` with a
  one-time seed upload of existing entries, `createInvite`/
  `joinWithInviteCode`)
- UI: real Share this business / Generate invite code / Join a shared
  business controls added to `LedgerTeamScreen` (Settings > Business
  Team), gated behind `isSyncConfigured()`
- Credentials committed as `.env.production` (deliberately — the
  publishable/anon key is meant to be public, protected by RLS, not a
  secret) so both the GitHub Actions APK build and the `docs/app`
  Pages build pick it up with no extra CI config

**Phase 2 — continuous sync (`b74325a`, `0a8ab56`):**
- `003_continuous_sync.sql`: added a `local_id` column (backfilled from
  each entry's own id) + unique `(book_id, local_id)` constraint so
  saves can upsert in place instead of duplicating rows; enabled
  Supabase Realtime on `entries`/`book_members`
- Every local save now also pushes to cloud (upsert + delete-diff, so
  deletions propagate too) whenever the owning ledger is shared —
  fire-and-forget, local write always happens first and is never
  blocked by the network
- `BookScreen` pulls a shared book's current state on open and
  subscribes to live Realtime updates while open
- **Bug caught before shipping:** naively re-saving pulled cloud data
  through the normal save path would re-push it, which Postgres
  reports as a change even when the data is identical, re-firing the
  realtime subscription — an infinite loop. Fixed with a separate
  `applyRemoteEntries` path that persists pulled data locally without
  re-pushing it.
- Known, accepted gap: conflict handling is last-write-wins only, no
  per-field merge. Real risk only if two people edit the *exact same
  entry* within the same couple of seconds — rare for this use case,
  explicitly deprioritized versus notifications.

**Push notifications on new entries (`e61e800`, in progress):**
- Confirmed via search that Google fully shut down the legacy FCM
  server-key API in 2024 — the current HTTP v1 API (OAuth via a
  Firebase service account) is the only path, so a real Firebase
  project is unavoidable, not a nice-to-have
- `@capacitor/push-notifications` added and synced into the Android
  native project (the `google-services` conditional-apply block in
  `app/build.gradle` already existed as unused boilerplate)
- `004_push_notifications.sql`: `device_tokens` table (RLS: own tokens
  only) + a `pg_net` trigger on `entries` insert calling an Edge
  Function
- `supabase/functions/notify-entry/index.ts`: looks up the book's other
  active members, their device tokens, gets an FCM OAuth token by
  signing a JWT with the service account key, sends via
  `fcm.googleapis.com/v1/.../messages:send`
- App registers the device's token on sign-in (native only), wrapped in
  try/catch so a not-yet-configured Firebase project fails silently —
  verified both CI builds (APK + Pages) still pass with the plugin
  present but no `google-services.json` yet
- Checked all 22 other repos in the org for any prior Firebase usage to
  potentially reuse — none found; only a discarded "Firebase or
  Supabase" naming mention (this Supabase decision) and an unrelated,
  never-built dating-app brainstorm doc that happened to sketch a
  Firebase stack. Confirmed a fresh Firebase project is genuinely
  needed, not duplicate work.

**Push notifications: fully wired end to end (2026-09-27).** Firebase
project "bejirond" created (Spark/free plan — confirmed FCM is free and
unlimited on both tiers). `google-services.json` received and committed
(`5de8490`) — first build where the `google-services` gradle plugin
actually activated, confirmed green. `notify-entry` deployed via the
Supabase dashboard's browser editor; had to turn off "Verify JWT with
legacy secret" on the function (it uses its own `x-notify-secret` header
instead). All three secrets set (`NOTIFY_SECRET`, `FCM_SERVICE_ACCOUNT_JSON`,
`FCM_PROJECT_ID`). **Found a real platform limit:** `ALTER DATABASE SET`
is not permitted on Supabase's hosted plans at all, even via the SQL
editor as the project owner (`ERROR: 42501: permission denied to set
parameter`) — so the planned "configure via Postgres settings" approach
in `004_push_notifications.sql` doesn't work as originally written.
Worked around by baking the real function URL + secret directly into
`notify_new_entry()`'s body via `CREATE OR REPLACE FUNCTION` instead;
migration file updated (`248a90f`) to document this as the actual path
for any future from-scratch setup. Not yet tested with a real second
device — that's the natural next step.



**Reported:** screenshot of the app's crash-safety-net screen (added last
night, `eb3ce24`) showing "Minified React error #310" with a minified
stack trace, no other context on what screen or action triggered it.

**Investigation:**
- First suspected the same-day splash-screen commit (`0f842ad`, "Re-show
  the intro splash once per update") since the timing lined up and it
  added a new top-level conditional early-return in `App.jsx`. Manually
  traced every hook call in the main `TallyBookApp` component against
  every early return — all hooks are declared before any of them, so
  that commit was cleared as the cause.
- Installed `eslint` + `eslint-plugin-react-hooks` (dev-only, not
  committed) and ran its `rules-of-hooks` check across the whole
  codebase rather than continuing to eyeball it. That's what actually
  found it.

**Root cause:** `MonthSummaryCard` (the collapsible "this month" summary
on the book screen) called the `useMonthTrend` hook *after* an early
`if (monthEntries.length === 0) return null;`. React requires the exact
same hooks, same order, every render. Trigger: open a book with nothing
logged yet this month (card renders null → 1 hook), then log that
month's first entry without leaving the screen (card now renders content
→ 2 hooks) — React detects the mismatch mid-render and throws. Introduced
by `2be4bb4` (the trend-analysis feature), so it predates last night's
crash-safety-net commit by a day — the boundary didn't cause this, it
just turned an existing silent-blank-screen bug into a visible, reportable
one.

**Fix:** moved the `useMonthTrend()` call above the early return so it
always runs. The hook itself already handled the "nothing to compare
yet" case safely (returns `null`), so no behavior change for users —
only the crash is gone.

**Verified:** `rules-of-hooks` re-run clean across every `.jsx` file
after the fix (was: exactly this one violation, nowhere else).
`npm run build` succeeds. Rebuilt and re-synced `docs/app/` (web build)
and ran `npx cap sync android` (native build — not tracked in git, so
this alone doesn't update any already-installed APK).

**Still open:** the actual device that hit this crash is running a local
APK build from before the fix. It needs a fresh `npm run build` +
`npx cap sync android` + APK rebuild/reinstall to pick this up — not yet
confirmed done.

---

## 2026-09-09 — Marketing site: About, FAQ, Disclaimer, social links, SEO/AEO

Added to `docs/index.html` (all translated into the existing 7 languages,
following the established pattern — English/Amharic/French/Arabic/Swahili
confident, Tigrinya/Afaan Oromoo best-effort, worth a native speaker's
once-over before wide traffic, same caveat as the language rollout):

- **About Bejirond** section (what the app is/why it exists) — separate
  from the pre-existing "About this download" section, which stays as-is.
- **FAQ** section, 7 questions, built with native `<details>/<summary>`
  (no JS needed for the accordion), plus a matching `FAQPage` JSON-LD
  block for answer-engine/rich-result pickup.
- **Disclaimer** section — not a financial institution, third-party
  trademark notice (Telebirr/CBE Birr/Coopay/M-Pesa/Android), no-warranty
  + local-only-data-loss notice.
- **Social links** row — pulled the real handles from teredatrades.com
  rather than guessing: Telegram (t.me/TeredaTrades), YouTube
  (@TeredaTrades), Discord (discord.gg/Cd6qRq2PVn). No Twitter/Instagram/
  Facebook found on the source site, so none added.
- **SEO/AEO**: canonical tag + twitter:card meta, `robots.txt`,
  `sitemap.xml`, and a `MobileApplication` JSON-LD block (alongside the
  FAQPage one above) with `sameAs` pointing at the social links and
  teredatrades.com.

Not done in this pass: the `app.bejirond.app` PWA subdomain deploy itself
(the relative-paths fix landed just before this) — still needs the actual
second Pages site set up and DNS pointed at it.

Copied from `TeredaTrades/bejrond-project-log` (`projects/bejrond/log.md`)
on 2026-08-22, so the project's decision history lives alongside the code
it's about instead of only in the separate log repo. The log repo remains
the source of truth going forward — treat this as a synced copy, not a
fork of it.

Newest entry on top.

---

## 2026-08-22 — Backlog audit: several open items were already built

Went through `NOTES.md` and this log against the actual `Bejirond` source
and found a handful of things still listed as open/undecided that were
already implemented, just never marked done:

- **Language toggle** — the 2026-08-15 "New idea from the user" entry
  below raised this as undecided (toggle vs. separate apps, which
  languages). It's built, and bigger than what was discussed: a
  single-app locale toggle (matching the leaning noted below, not
  separate per-language apps) covering **7 languages** — English,
  Amharic, Oromifa (Afaan Oromoo), Tigrinya, French, Arabic, Swahili —
  with each language's native-script name shown in the picker
  (`src/i18n/`). Tigrinya wasn't even in the original discussion.
- **Crowdsourced translation suggestions** — also built
  (`src/translationSuggestions.js`): in-app "suggest a better
  translation" form, stored on-device, shared out via the OS share
  sheet. No backend involved, consistent with the offline-only
  architecture.
- **Ethiopian/Gregorian calendar switching** and **per-category expense
  analysis** (pie chart + filterable Reports screen) — both built,
  previously just mis-filed under `NOTES.md`'s Inbox/To-add sections
  instead of Done.
- **Telebirr / CBE Birr / Coopay** — added to the default payment
  methods list (along with M-Pesa), closing the "add to payment methods
  list" note.

No code changed for any of this — just correcting the record. Still
genuinely open, confirmed by checking source: backend for team/
cross-device sharing, ads-vs-paywall + AdMob, ዱቤ credit tracking, SME
features (invoicing/inventory/supplier DB), Home dashboard summary,
Fasika holiday theme, per-app Android `applicationId`/Play Store
listings, PWA hosting, receipt scanning (OCR) and the split-the-bill/
shared-receipt features that depend on it, Telegram/WhatsApp
integration, "simpler ways to add members," and iOS support.

## 2026-08-19 — Team/cross-device sharing needs a backend decision (found in tallybook-app, not yet in this log)

**Scoping gap, not previously logged here.** Pulled from
`tallybook-app/CHANGELOG.md` (2026-08-14 entry) — recorded here so it's
in the project's actual decision log, not buried in the app-code repo's
changelog:

- **Real cross-device sharing (a second person seeing/editing the same
  book on their own phone) does not exist.** The app is fully
  offline/on-device only (Capacitor Preferences storage, nothing sent to
  any server — this is a deliberate, marketed feature, see README). Right
  now "Members" under Settings > Business Team is **local role-simulation
  only** — adding a member writes to that one phone's storage and does
  not sync anywhere.
- **This needs a scoping decision before it's buildable**: a real backend
  (Firebase or Supabase were the two named) would be required for actual
  multi-user sync. Nothing chosen yet.
- **Precedent in this project family**: ገበያ (Gebeya) already chose
  **Supabase** (listings table + row-level security) when it needed real
  multi-user data — the one existing example of this family adding a
  backend for a feature that couldn't stay local-only. Worth treating as
  the default option to evaluate first if/when this gets scoped, rather
  than starting from zero.
- **Tension to resolve when scoping this**: offline/no-server-ever is
  part of Bejirond's identity and privacy pitch (see go-to-market notes —
  "your data never leaves your phone" is meant to be a headline feature).
  Adding a backend for team sync means deciding whether that's opt-in
  only for the team-sharing feature specifically (solo use stays fully
  offline, sync only activates once a book is shared) or a broader
  architecture change. Not discussed yet — flagging so it's not
  overlooked when this is picked up.
- Related open item, also pulled from `tallybook-app/NOTES.md`'s inbox
  and not previously in this log: **"Simpler ways to add members"** — a
  standalone UX note, separate from the sync question above (this is
  about how a member gets added locally today, not about cross-device
  sync).

---

## 2026-08-15 (update 2) — `main` reconciled with `individual-base`

**Merged `individual-base` into `main`.** `main` was missing the entire
product-variant system — no `appConfig.js`, no `dataPortability.js`, no
working "More Apps" screen. It now has all of it; `main` still builds as
`APP_VARIANT = "bundle"` as before, this was purely catching it up on
shared code `individual-base` had moved ahead on.

**Also merged the ገበያ/አጋፋሪ catalog update (from the entry below) into all
three remaining `individual/*` branches** — `individual/budget`,
`individual/loan-calculator`, `individual/trip-organizer` — each pushed,
triggering their own APK builds. All five branches (`main` +
four `individual/*`) now agree on the product catalog.

**Real bug found and fixed during the `main` merge, flagged but NOT yet
backported:** `individual-base` had regressed the Delete Business flow —
it deletes immediately on tap with **no confirmation dialog at all**.
`main` had a proper Yes/No confirm (with a message naming the business
and book count) that never made it over to `individual-base` when the
branches diverged. Kept `main`'s version during the merge (confirm dialog
+ softer delete wording "You won't be able to get this back once it's
gone." used consistently). **This fix is still only on `main`** — every
standalone `individual/*` app (already re-merged with the catalog update
above) still ships without the confirmation. Backporting this into
`individual-base` and re-merging into all four `individual/*` branches
is a small, clean follow-up — not done yet, flagged for whenever this is
picked back up.

## 2026-08-15 (update) — Branch confusion resolved; More Apps catalog updated; new placeholder branch

**Which branch is which (important — this tripped up the session):**
- **`main`** = the bundle build. Was stale (missing the whole product-
  variant refactor) as of earlier this session — **reconciled with
  `individual-base` later the same day, see entry above.**
- **`individual-base`** = the shared codebase. Has the full variant
  system (`appConfig.js` picks `APP_VARIANT`, everything else — screens,
  components, data logic — is shared). Canonical for anything touching
  the "More Apps" screen or the product catalog.
- **`individual/expenses-manager`, `individual/budget`,
  `individual/loan-calculator`, `individual/trip-organizer`** — each just
  overrides `APP_VARIANT` on top of `individual-base`, merged in
  regularly. These are what the standalone single-tool APKs build from.
  Also carry extra CI steps `individual-base` itself doesn't have yet
  (the `individual/**` push trigger + GitHub Release publishing step —
  `individual-base`'s own workflow file is still main/master-only).

**More Apps catalog change (on `individual-base`, in `appConfig.js`):**
- Renamed the `trip-organizer` product from "በጅሮንድ Trip Organizer" to
  just **"አጋፋሪ"**, tagline "Your one-stop shop for experiences & vibes".
  አጋፋሪ is confirmed as the name for the *expanded* trip-organizer concept
  (see `projects/agafari/log.md` — the itinerary/coordination-hub-and-
  beyond project), not a separate product from it.
  If አጋፋሪ ever gets its own language-specific variant apps later, each
  would use that language's equivalent term rather than reusing "አጋፋሪ".
- Added a new **`marketplace`** entry: name "ገበያ", tagline "Buy & sell
  marketplace", `playStoreUrl: null` — this makes it show up in every
  variant's "Also available separately" list. `playStoreUrl: null`
  renders as a styled, non-clickable "Get" button (existing pattern —
  not a "Coming soon" pill), matching what was asked for.
- Merged into all four `individual/*` branches and into `main` (see
  entry above) — every branch now agrees on the catalog.

**New `individual/marketplace` branch created** (placeholder only):
- Branched from `individual-base`, `APP_VARIANT` set to `"marketplace"`.
- Important: this branch has **no marketplace UI at all** — none exists
  in this codebase's `App.jsx`. The real marketplace app is entirely the
  separate `Gebeya` repo (see `projects/gebeya/log.md`). This branch
  exists only to reserve the slot / keep the branch-per-product pattern
  visually complete, in case a lightweight companion build is wanted
  here later. Documented with an explicit comment in `appConfig.js` so
  this isn't mistaken for a real build later.
- Had to backport the `individual/**` trigger + release-publish workflow
  steps onto this new branch by hand (copied from
  `individual/expenses-manager`), since `individual-base` (the branch it
  came from) doesn't have those yet.

## 2026-08-15 — Repo access expanded; ads/paywall + language-toggle idea logged

**Access:** Token updated to include this whole project family
(`tallybook-app`, `-Expenses-Tracker-app`, `bejrond-project-log`,
`Gebeya`, `Agafari`) plus the unrelated `TeredaTrades/general-brainstorming`
and `teredatrades-project-log` (separate trading-tools operation) repos.
Confirmed `-Expenses-Tracker-app` is the standalone spinoff build of just
the Expenses Manager feature, pulled from the same shared `individual-base`
codebase as the bundle app — not a separate product idea.

**New idea from the user, to fold into scoping whenever this project is
picked back up:**
- Considering ads and/or a paywall on some options in the Expenses Manager
  and/or Loan Calculator. Given this is a personal-finance ledger handling
  real financial data (unlike a more casual utility), leaned toward
  paywall-for-advanced-features over ads for trust reasons when discussed
  — not yet decided.
- Wants a language toggle: English / Amharic / Oromifa first, then
  French / Arabic / Swahili if/when expanding to Sub-Saharan Africa more
  broadly. No locale/language handling exists in the codebase yet — this
  would be new work.
- Raised whether each language variant should be its own separate app
  (each with its own culturally-resonant single-word name, the way
  "በጅሮንድ" works for the Amharic finance-keeper concept) vs. one app with
  a toggle. Flagged that separate-apps-per-language would cut against
  this family's established pattern of splitting by *product* (በጅሮንድ /
  ገበያ / አጋፋሪ), not by *language* — leaning toward a locale toggle within
  one app for consistency, not yet decided.
- User has Oromo relatives/Afaan Oromo speakers (already consulting them
  on a separate Oromo-custom dating-app question) and will ask them
  whether Oromifa has an equivalent single-word term for "keeper of
  assets/treasurer," same concept as በጅሮንድ.

## 2026-08-14 (update)

**Rename finding, confirmed by inspecting the repo:** `capacitor.config.json`'s
`appName` field is already set to `"በጅሮንድ"`, while the repo itself is still
named `tallybook-app`. This effectively answers the open rename question —
the lighter-touch path (docs/app-facing name changes, repo name stays) is
already partially in place. No further action needed unless the repo name
itself should also change.

**ገበያ scaffolded** — `TeredaTrades/Gebeya` repo created, initial skeleton
pushed: React+Vite+Capacitor matching this project's exact stack
(`capacitor.config.json` copied and adapted), Supabase for backend
(listings table + RLS), browse/post views. See `projects/gebeya/log.md`
for details on what's decided vs. still open.

## 2026-08-14

**Naming:** Proposed renaming tallybook-app to በጅሮንድ. Not yet confirmed
whether that means renaming the actual GitHub repo (which changes the
clone URL — GitHub redirects the old one for a while, but anything with
the URL hardcoded, like CI or other repos referencing it, would need
updating) or just having docs/logs refer to it as በጅሮንድ going forward
while the repo itself stays `tallybook-app`. Decision pending.

**Context for the rename:** it's the parent project that ገበያ and አጋፋሪ are
spinning off from. Both are being built as standalone repos, not as
`individual/<product>` branches of this repo, since they have their own
data models and user bases with nothing shared with this app's ledger/
budget logic.

**Existing pattern this project established, reused for the spinoffs:**
React + Vite + Capacitor — one codebase builds to both an installable app
and a website, rather than maintaining two separate builds.
