# በጅሮንድ (Bejirond) — decision log

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
