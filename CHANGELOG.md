# Changelog

A running log of what's been built or changed, so we both have a shared
record without needing to scroll back through chat history.

## 2026-08-15 — Softened entry-delete confirmation wording
Matched `main`'s softer entry-delete confirmation message ("You won't be
able to get this back once it's gone.") on this branch too, replacing the
older, blunter "This can't be undone." — the one piece of the earlier
Delete Business confirmation backport that was deliberately left out
until now.

## 2026-08-15 — Backported Delete Business confirmation dialog
`individual-base` and `individual/expenses-manager` were still missing the
Delete Business confirmation dialog that `main` picked up in the earlier
reconciliation (Delete Business fired immediately on tap, no confirm step).
Backported the same `ConfirmModal` + book-count-aware message from `main`.
Note: `main`'s softer entry-delete wording ("You won't be able to get this
back once it's gone.") was NOT backported here — these two branches still
say "This can't be undone." for entry deletes. Flagging as a separate open
item, not bundled into this fix.

## 2026-08-15 — Gated business-only Settings items behind the expenses-manager gate
`SettingsScreen` listed "Business Team", "Move & Copy Book Requests", and
"Business Settings" unconditionally on every `APP_VARIANT`, not just the
bundle and Expenses Manager where those concepts apply. On the other
single-tool builds (Budget, Loan Calculator, Trip Organizer, Marketplace)
this let someone reach a Delete Business button that crashed the app,
since those variants never have an `activeBusiness`. Wrapped the three
items in the same `IS_BUNDLE || APP_VARIANT === "expenses-manager"` gate
already used for the Home card and Cashbooks tab.

## 2026-08-14 — Entry sort/time fix, delete confirmation, remark-first list, real back button
- **Entries not re-sorting after a date edit**: found the actual cause — the entry
  Time field was free text, so editing it (or an existing entry's original time)
  could produce a string the sort logic couldn't parse, which silently made that
  entry sort as midnight regardless of its real time, making edited entries look
  "stuck." Time is now a native time picker (always a valid value), and the sort
  parser accepts both the new format and every legacy free-typed value already
  saved, so nothing existing breaks. Applies everywhere a time is shown (entry
  list, entry detail, CSV export).
- **Delete confirmation**: a Delete button now sits next to Move/Copy in the
  multi-select action bar (long-press or tap the checkmark to select, same as
  Move/Copy), and deleting (from there or from the existing Edit Entry trash icon)
  now asks "Delete this entry? / Yes, Delete / No" before removing anything.
- **Entry list row**: the bold headline now shows the remark instead of the
  contact/sender name — useful when several transactions go to/from the same
  person and the remark is what tells them apart. Falls back to contact/category
  only when no remark was entered. The color and arrow already convey Cash In vs.
  Cash Out, so that label is no longer duplicated in the row text either.
- **Hardware back button**: previously any back-button press minimized the app
  immediately, regardless of how deep you were. It now closes an open sheet/
  select-mode first, then steps back through the screen stack one screen at a
  time, then falls back to Home, and only exits the app once there's truly
  nowhere left to go back to. Added the `@capacitor/app` plugin for this (new
  native dependency — first run after pulling this needs `npx cap sync android`,
  already done here).
- All four fixes are in the shared `BookScreen`/`AddEntryScreen`/root-navigation
  code, so they apply to both the full bundle and the standalone Expenses Manager
  build, merged here from `individual-base` on top of this branch's own
  ctx-aware `TopHeader` (light/dark toggle) — the delete-confirm button now
  triggers the confirm modal instead of calling delete directly.

## 2026-08-13 (cont. 15) — [individual/expenses-manager branch] Light/dark toggle on every page, "More በጅሮንድ Apps" nav label fix
- This standalone build has no Home screen, so it previously had no way at all to
  switch between light and dark theme — the sun/moon quick-toggle only existed on
  the bundle's Home header. Added the same toggle button to `TopHeader` (used by
  every screen with a top bar — Book, Entry, Reports, Settings, Loan Calculator,
  etc.), to the Cashbooks list screen's bespoke business-switcher header, and to
  the pre-login Welcome / Welcome back (PIN) screens, so every page in this build
  now has a one-tap way to flip the theme, matching the bundle's behavior.
- Fixed the bottom-nav tab label for this build's More Apps screen — it still read
  the placeholder "More Apps" instead of the "More በጅሮንድ Apps" branding already
  used as that screen's own header title.

## 2026-08-13 (cont. 14) — [individual/expenses-manager branch] Merged More Apps branding, "Get" buttons, trading card
- Merged in from `individual-base`: More Apps screen title, product names, and
  "Get" buttons now carry the በጅሮንድ branding, and the "Want to learn about
  trading?" card was added to this screen — see the `individual-base` entry
  below (cont. 12) for the full description. Applies here unchanged, and is
  especially relevant on this branch since it has no Home screen, so More Apps
  is this build's only route to the trading card.

## 2026-08-13 (cont. 13) — [individual/expenses-manager branch] CI: build on push, publish APK as a Release
- The build workflow only auto-triggered on push to `main`/`master`, and there was
  no way to trigger it for this branch without repo Actions permissions this token
  doesn't have — so `individual/expenses-manager` (and any future `individual/**`
  branch) now also builds on every push, same as `main`.
- The APK is now also published as a GitHub Release asset (tagged
  `build-<branch>-<run number>`), in addition to the existing Actions-tab artifact.
  Actions artifacts require being signed into GitHub to download; a Release asset
  has a plain URL that works without that, which is what makes it possible to grab
  the APK from here to hand to you directly.
- Scoped to this branch only for now rather than merged back through
  `individual-base`/`main`, since it's CI infrastructure rather than an app feature
  — worth folding into the shared branches later if the team wants every branch to
  build+release automatically.

## 2026-08-13 (cont. 12) — [individual/expenses-manager branch] Merged Select Business always-shown & fainter floating icon
- Merged in from `individual-base`: the Expenses Manager always opens on Select
  Business now, even with only one business saved, and the floating icon (Settings >
  Quick Access) is smaller and semi-transparent — see the `main` entry further below
  (cont. 10) for the full description. Applies here unchanged.

## 2026-08-13 (cont. 11) — [individual/expenses-manager branch] No Home screen; land on business selector
- Merged in from `individual-base`: cross-business move/copy and Settings > Quick
  Access (home screen widget + floating icon), same as the bundle — see the `main`
  entry further below (cont. 9) for the full description.
- This build's Home tab is now gone entirely (it never had a use for the marketplace
  link, forex ticker, or financial news anyway, per its original "no Home hub" scope).
  First launch of a new account goes straight into the "what will you manage?"
  business-type question if no business exists yet; every launch after that lands
  directly on the business selector (the Cashbooks screen, which shows the Select
  Business picker itself for anyone with 1+ businesses) instead of a Home screen.
  Bottom nav is now Cashbooks / Help / More Apps / Settings.
## 2026-08-13 (cont. 12) — More Apps branding, "Get" buttons, trading card
- More Apps screen title changed from "More Apps" to "More በጅሮንድ Apps".
- Every product name shown on that screen now carries the በጅሮንድ prefix:
  the bundle card is now "በጅሮንድ Finances" (was "በጅሮንድ — All-in-One"), and
  the four single-tool products are "በጅሮንድ Expenses Manager", "በጅሮንድ Loan
  Calculator", "በጅሮንድ Budget", and "በጅሮንድ Trip Organizer".
- The grayed-out "Coming soon" pill (shown when a product has no
  `playStoreUrl` yet) is now an actively-styled "Get" button instead —
  doesn't link anywhere yet since the Play Store URLs still aren't set up
  (see NOTES.md), but no longer looks disabled. The existing linked button
  is now labeled "Get" too (was "Get it"), so both states read the same.
- Added the "Want to learn about trading?" placeholder card (not linked
  yet — same as the one on Home) to the bottom of the More Apps screen too,
  since the Expenses Manager standalone build has no Home screen and
  otherwise had no way to reach it.
- Made on `individual-base` and merged into all four `individual/*` product
  branches. `main` is unaffected — the bundle build's "more" tab is the
  Import screen, not this one.
## 2026-08-13 (cont. 10) — Business picker always shown, smaller/fainter floating icon
- Expenses Manager (Cashbooks) now always opens on the "Select Business" screen on
  a fresh session, even for a user with only one business — previously that screen
  only showed when there were 2+ businesses, and a single-business user was dropped
  straight into their books. The "Select Business" screen's copy adjusts depending on
  whether there's one business or several. This applies to both the full bundle app
  and the standalone Expenses Manager build, since both share the same underlying
  screen. A user with 0 businesses is unaffected — they still land on "what will you
  manage?" to create their first one, since there's nothing yet to pick between.
- The floating icon (Settings > Quick Access) is now smaller (40dp, was 56dp) and
  semi-transparent (55% opacity) so it sits more quietly over whatever app it's
  floating on top of, rather than fully solid at a larger size.

## 2026-08-13 (cont. 11) — [individual-base branch] Merged Select Business always-shown & fainter floating icon
- Merged in from `main`: the Expenses Manager always opens on Select Business now,
  even with only one business saved (previously that screen was skipped at 0/1
  business — see the `main` entry below for the full description), and the floating
  icon (Settings > Quick Access) is smaller and semi-transparent. Applies here
  unchanged and carries forward into every `individual/*` product branch merged
  from this one, including `individual/expenses-manager`.

## 2026-08-13 (cont. 10) — [individual-base branch] Merged cross-business move/copy & Quick Access
- Merged in from `main`: cross-business move/copy for the Expenses Manager, and
  Settings > Quick Access (home screen widget + floating icon). See the `main`
  entry below (cont. 9) for the full description — applies here unchanged since
  none of it is bundle-specific, and carries forward into every `individual/*`
  product branch merged from this one, including `individual/expenses-manager`.

## 2026-08-13 (cont. 9) — [individual-base branch] Business picker on login
- Ported the same fix already on `main`: the Expenses Manager now shows the
  Select Business picker each time a returning user with 2+ businesses logs
  back in, instead of silently reopening whichever business was last active.
  Picking (or dismissing) the picker only prompts once per session; users
  with 0 or 1 business are unaffected and go straight in as before. This
  applies to every `individual/*` product branch merged forward from here,
  including `individual/expenses-manager`.

## 2026-08-13 (cont. 8) — [individual-base branch] Product split scaffold
This branch (`individual-base`) is the shared starting point for the
single-tool, ad-supported apps (`individual/expenses-manager`,
`individual/loan-calculator`, `individual/budget`, `individual/trip-organizer`).
`main` stays the full paid bundle. See NOTES.md "Branch structure" for the
overall plan.

- Added `src/appConfig.js`: one `APP_VARIANT` constant ("bundle" or a
  product id) is now the only thing that should differ between `main` and
  each `individual/*` branch — everything else is shared code that merges
  cleanly. Home's tool cards and the bottom nav's Cashbooks tab now read
  this to show only the relevant tool(s).
- Added a "More Apps" / "Import" bottom-nav tab:
  - On the bundle build, it's an **Import data** screen — pick an export
    file from a standalone app and merge that product's data in.
  - On a single-tool build, it's cross-promotion: the other standalone
    apps + an upsell card for the full bundle (Play Store links show
    "Coming soon" until each product has its own package name/listing —
    see NOTES.md), plus an **Export** action to save that app's data to a
    file for later import into the bundle.
- Added `src/dataPortability.js`: export/import is file-based (JSON, via
  the existing Filesystem+Share pattern used for CSV/PDF), not automatic
  detection — Android sandboxes each installed app's storage separately,
  so two separately-installed apps can never read each other's data
  directly even though they share this codebase. Each product's export is
  scoped to only its own storage keys (e.g. Budget's export never touches
  `businesses`/`entries:*`), so importing into the bundle can't clobber
  other tools' data. Loan Calculator has nothing to export today since it
  doesn't persist anything between sessions.
- Ads were deliberately left out of this pass (network not decided yet —
  see NOTES.md).

## 2026-08-13 (cont. 9) — [main branch] Cross-business move/copy, Quick Access widget & floating icon
- Move/copy an entry (or a multi-select batch) in the Expenses Manager can now target
  a book in *any* of the user's businesses, not just the currently active one. The
  Move/Copy sheet groups target books by business (active business first, unlabeled;
  every other business under its own header) so it's always clear which business a
  book belongs to before sending money into it. When a move/copy crosses businesses,
  the entry's "transferred from" stamp includes the source business name for clarity.
- Added Settings > Quick Access with two opt-in ways to reach the Expenses Manager
  without opening the app first:
  - **Home screen widget** — a small tile showing the net balance across every
    business; tapping it opens the app. "Add widget to Home screen" uses
    `AppWidgetManager.requestPinAppWidget` where supported (Android 8+), otherwise
    shows manual long-press-to-add instructions. The balance is pushed from the app
    (after every entry save, and on launch) into a small native widget provider —
    the widget itself doesn't read app data directly.
  - **Floating icon** — a small draggable bubble that floats over other apps and
    opens TallyBook on tap; drag to reposition, tap (without dragging) to open.
    Requires the "display over other apps" permission — the toggle sends the user to
    system Settings to grant it once, then starts/stops a foreground service that
    hosts the bubble. A low-priority "TallyBook floating icon is on" notification is
    required by Android for any service that outlives the app being open, and doubles
    as a quick way back to Settings to turn it off.
  - Implemented via a small app-embedded (not published) Capacitor plugin
    (`TallyWidgetPlugin`) plus `ExpensesWidgetProvider` (widget) and `BubbleService`
    (floating icon) — new Android permissions: `SYSTEM_ALERT_WINDOW`,
    `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE` (none requested until the
    user opts in from Quick Access).
  - Known gap: this couldn't be verified on a physical device or emulator from here —
    only that the web bundle builds and `npx cap sync android` completes cleanly. The
    actual native compile is validated by the GitHub Actions build; if the floating
    icon behaves oddly on a given OEM's Android build, that's the first thing to check.

## 2026-08-13 (cont. 10) — [main branch] Select Business always shown, fainter floating icon
- Expenses Manager (Cashbooks) now always opens on the "Select Business" screen on
  a fresh session, even for a user with only one business — previously that screen
  only showed when there were 2+ businesses, and a single-business user was dropped
  straight into their books. The "Select Business" screen's copy adjusts depending on
  whether there's one business or several. This applies to both the full bundle app
  and the standalone Expenses Manager build, since both share the same underlying
  screen. A user with 0 businesses is unaffected — they still land on "what will you
  manage?" to create their first one, since there's nothing yet to pick between.
- The floating icon (Settings > Quick Access) is now smaller (40dp, was 56dp) and
  semi-transparent (55% opacity) so it sits more quietly over whatever app it's
  floating on top of, rather than fully solid at a larger size.

## 2026-08-13 (cont. 8) — [main branch] Clean up misplaced standalone-build scaffold
- The previous entry below added a `VITE_APP_VARIANT`/`.env.standalone`
  build-variant scaffold directly on `main` to produce a standalone
  Expenses Manager build. That duplicated the branch structure that
  already exists for this (`individual-base` and the `individual/*`
  product branches, differentiated by `src/appConfig.js`), so it's been
  removed from `main` — `npm run build:standalone`, `.env.standalone`,
  `capacitor.config.standalone.json`, and the `IS_STANDALONE_EXPENSES`
  switch in `App.jsx` are gone. `main` now only builds the full bundle
  again, same as before that scaffold was added.
- The actual business-picker-on-login fix (below) is unaffected and stays
  on `main`. The same fix has also been ported onto `individual-base` and
  merged into `individual/expenses-manager`, so the real standalone
  Expenses Manager app (built from that branch) gets it too.

## 2026-08-13 (cont. 7) — [main branch] Business picker on login, standalone Expenses Manager APK
- Fixed Expenses Manager (Cashbooks) so that a returning user with more than
  one business now lands on the "Select Business" picker each time they log
  back in (after the Welcome back PIN screen), instead of being silently
  dropped straight into whichever business happened to be active last
  session. Picking a business (or dismissing with the X, which keeps the
  previous one) only asks once per session — navigating between tabs
  afterward doesn't re-prompt. Users with 0 or 1 business are unaffected and
  go straight in as before.
- Added a second, standalone build of just the Expenses Manager: Welcome/PIN,
  business picker, and books/entries only — no Home hub, and therefore no
  Loan Calculator, Budget, Trip Organizer, forex ticker, or financial news
  (Home is their only entry point, so removing it drops them too). Built via
  `npm run build:standalone` (new Vite mode, `VITE_APP_VARIANT=standalone-
  expenses`) into its own `dist-standalone` folder, packaged as its own APK
  (`com.teredatrades.tallybook.expenses`, labeled "TallyBook Expenses" on the
  Android launcher so it can be installed side by side with the full app).
  The GitHub Actions workflow now builds both APKs on every push and attaches
  them to a new GitHub Release for that run (in addition to the existing
  Actions-tab artifacts), so both are downloadable without needing a
  workflow re-run per variant.

## 2026-08-13 (cont. 6) — Quick toggle, pattern themes, holiday themes
- Added a light/dark quick-toggle button (sun/moon icon) to the Home screen
  header — one tap flips between light and dark regardless of which theme
  was active, no need to go into Settings > Appearance.
- Appearance screen is now grouped into three sections: Solid (the original
  6 flat-color themes), Pattern, and Holiday.
- Softened the Pink theme to lighter, more pastel shades (was a fairly
  saturated hot-pink palette).
- Renamed the "Islamic" theme to "Green & Gold" — same green/gold palette,
  just a more general name (theme id unchanged, so existing users' saved
  selection carries over automatically).
- Added 3 new Pattern themes: Light Dots, Dark Grid, and Terracotta Waves —
  each pairs a color palette with a subtle background pattern (dot grid,
  line grid, diagonal weave). The pattern only paints the app's background
  layer; every card and form field still sits on a fully solid surface
  color on top of it, so patterns never reduce text or form legibility.
- Added 7 Holiday themes (New Year, Genna, Timkat, Eid, Enkutatash, Meskel,
  Christmas), each with its own palette + pattern, selectable any time from
  Settings > Appearance.
- Home now shows a dismissible banner suggesting the matching holiday theme
  in the days around that holiday ("Try it" applies the theme, the X
  dismisses it for that occurrence — it won't nag again that year). Eid
  al-Fitr and Eid al-Adha are lunar-calendar holidays pinned to their 2026
  Gregorian dates (Mar 20 and May 27) and will need updating for future
  years, same upkeep tradeoff as the ETB/AED/KES snapshot exchange rates.

## 2026-08-13 (cont. 5) — Theme support
- Added an Appearance screen under Settings with 6 theme presets: Light
  (the existing default look), Dark, Brown & Cream, Pink, Islamic (green &
  gold), and Minimalist. Tap one to switch instantly; the choice is saved
  on-device and re-applied on next open.
- Implemented as a CSS variable layer (`src/theme.css`) that re-points the
  app's existing color classes (bg-white, text-slate-800, bg-teal-700,
  bg-amber-700, bg-sky-700, bg-rose-700, form control backgrounds, etc.) to
  theme-specific values, rather than rewriting colors on every screen
  individually. This means any current or future screen that keeps using
  the app's normal slate/teal/amber/sky/rose classes will automatically
  follow whichever theme is selected, with no per-screen changes needed.
- Known gap: the expense breakdown pie chart's per-category slice colors
  are a fixed palette of hex values (chosen for contrast between slices,
  not tied to the color classes above) — they don't shift with the theme.
  Left as a known limitation for now rather than in scope for this pass.

## 2026-08-13 (cont. 4) — Real news headline images
- The Home screen's Financial News section now shows a real image next to
  each headline instead of the old static 4-link list (Reuters/Bloomberg/
  Yahoo Finance/CNBC). Pulled from the free, no-signup saurav.tech mirror
  of NewsAPI.org's business top-headlines feed — each row shows the
  article's thumbnail, title, and source, and taps through to the full
  article.
- Falls back gracefully at two levels: if the feed fetch fails entirely
  (or returns nothing usable), the section falls back to the original
  static link list; if an individual headline has no image or the image
  fails to load, that row falls back to the generic newspaper icon
  instead of breaking the layout.
- This mirror is community-run and best-effort (not truly real-time,
  uptime isn't guaranteed) — noted in NOTES.md as the accepted trade-off
  for a free, no-key source.

## 2026-08-13 (cont. 3) — Budget & Trip Organizer, bigger Home buttons
- Expenses Manager and Loan Calculator buttons on Home are now bigger (more
  padding, larger icon/text) and stack full-width on narrow phones, only
  sitting side by side once the screen is wide enough.
- Added a Budget button on Home, below those two. Opens its own page: add
  any number of expected income sources and expected expenses, see the
  total income, total expenses, and what will remain (or the shortfall),
  then split that remainder across named folders — quick-add chips for
  Savings and Vacation Plan, or add a custom one — with a running
  allocated/unallocated total. Includes a short 50/30/20-rule note as a
  general budgeting reference.
- Added a Trip Organizer button on Home, below Budget. Opens its own page:
  create any number of trips, each with a destination, start/end dates,
  and a trip budget, plus a per-trip packing/to-do checklist (add, check
  off, remove items) and a free-form plans/notes field for itinerary
  ideas and bookings to confirm.
- Both are stored on-device only (same local storage approach as the rest
  of the app), independent of the multi-business books data.

## 2026-08-13 (cont. 2) — Exchange rates, home navigation, Add Member, loan calculator fee
- Fixed the Home exchange rate widget, which had stopped working: the API it called,
  api.frankfurter.app, has moved to api.frankfurter.dev with different query parameter
  names and a different response shape. Pointed the fetch at the current domain/params
  and updated the parsing to match the new response format.
- Fixed "no way back to Home from other screens" — the bottom nav bar (Home / Cashbooks /
  Help / Settings) was only shown while exactly one screen deep, so it disappeared the
  moment you opened a book, a settings sub-page, the loan calculator, etc., leaving only
  a back arrow that steps back one screen at a time. The bottom nav is now always visible,
  so any tab (including Home) is always one tap away regardless of how deep you are.
- Fixed Add Member not working from either place it's offered (a book's Manage Members
  page, and Settings > Business Team): both screens were missing the bottom padding used
  elsewhere in the app to keep the floating "to buy/pay" button from sitting on top of
  page content, so the floating button could intercept taps meant for the Add Member
  button. Added the same padding fix used on other screens, and the button is now
  visibly disabled until a name is entered instead of silently doing nothing.
- Loan Calculator: renamed "Total Paid" to "Total Payable" (summary card and the by-year
  schedule column). Added an optional "Other mandatory monthly payment" field for fees
  some lenders charge every month regardless of the loan (e.g. account/insurance fees) —
  it's added on top of each month's payment rather than folded into the amortization
  math, and shows up as its own line in the summary and as an extra column in both the
  monthly and yearly schedule views when set.

## 2026-08-13 (cont.) — Welcome / Welcome back screens
- Replaced the old first-launch "pick a business type" screen. First time
  opening the app now shows a Welcome screen: "Create an account" (name +
  a local 4–6 digit PIN, stored on-device only — this is a lock screen,
  not real authentication, there's still no backend) or "Use without an
  account". Every subsequent open shows a Welcome back screen instead —
  a PIN prompt if one was set (with a "Forgot PIN? Reset local account"
  fallback), or straight through to the app if not
- The "what will you manage?" business-type question (Business / Personal
  / Just exploring) moved out of first launch and into the Expenses
  Manager — it now shows the first time someone opens Expenses Manager
  before any business has been created, since that's the tool it's
  actually about

## 2026-08-13 — Trading button, birr exchange rates, member fix, inline calculator
- Added a "Want to learn about trading?" button to Home, below the
  financial news list — placeholder only, not linked to anything yet
  (waiting on the TeredaTrades URL/Telegram channel)
- Reworked the Home exchange rate widget to be birr-first: it now shows
  1 USD/GBP/EUR/CAD/CNY/JPY/AED/KES in Ethiopian birr instead of the old
  USD-based EUR/GBP/JPY/ETB/INR/CNY list. EUR/GBP/CAD/CNY/JPY still come
  live from Frankfurter (USD base, pivoted into birr); ETB, AED, and KES
  aren't published by any free no-key exchange rate API, so those three
  use a manually-looked-up snapshot rate (documented in the code) instead
  of updating live — worth refreshing periodically
- Fixed a real dead end: Settings > Business Team showed the business's
  members but had no way to actually add one (just text saying "add
  members from a book's settings"). Added a working inline add-member
  form directly on that screen
- Added an inline calculator to the entry Amount field — you can type a
  quick expression like "500+120-30" straight into the field and it
  evaluates live, or tap the calculator icon to expand a small tap-pad
  for entering it by hand
- Logged two items in NOTES.md that still need a decision before being
  built: which source to pull real per-headline images from for the news
  list, and what "create an account" should actually mean for a fully
  offline app with no backend

## 2026-08-12 (cont. 3) — Per-year loan payables view
- The Loan Calculator's amortization schedule now has a By Month / By Year
  toggle. By Year rolls the monthly payments up into one row per year —
  total principal paid, total interest paid, total paid, and remaining
  balance at year-end — so you can see the shape of a long loan (e.g. a
  30-year mortgage) without scrolling through hundreds of monthly rows.

## 2026-08-12 (cont. 2) — Show remark in the entries list
- The entries list now shows an entry's remark right in the row (below the
  date/time/payment-mode line), so it's visible at a glance without opening
  the entry — previously it was only visible on the Entry Detail screen.

## 2026-08-12 (latest) — Home landing page, louder reminders, layout fix
- Added a Home landing screen — now the first thing you land on when opening
  the app (new first tab in the bottom nav). It has Expenses Manager and
  Loan Calculator as two buttons side by side, a "Buy & Sell Marketplace"
  link (currently pointed at Jiji, easy to swap for another site), live
  foreign-exchange rates for major currencies (EUR, GBP, JPY, ETB, INR, CNY
  vs. USD, via the free Frankfurter API — no signup/key needed), and a
  quick-links list to financial news sites (Reuters, Bloomberg, Yahoo
  Finance, CNBC). Removed the Loan Calculator entry from Settings since
  it's now reachable from Home instead.
- Reminders are now louder and do more than a bar notification: added a
  dedicated high-importance Android notification channel with a custom
  alarm-style tone and strong vibration, so reminders show as a heads-up
  banner with sound even when the app is fully closed. Tapping the
  notification (or the reminder firing while the app is already open) now
  pops up an in-app alarm card with the item's description, amount, and
  category, plus Snooze (10 min) / Mark done / Dismiss actions — instead of
  just a silent line in the notification shade.
- Fixed a real bug found along the way: `@capacitor/local-notifications`
  was never actually registered in the native Android project (missing
  from `capacitor.settings.gradle` / `capacitor.build.gradle`), so
  reminders likely weren't firing as native notifications at all before
  this. Running `npx cap sync android` picked this up and fixed it.
- Fixed the floating "to buy/pay" button covering Save/Add buttons (most
  noticeable when naming or renaming a book) — the button now hides itself
  whenever a text field is focused, so it can't sit on top of a
  keyboard-pushed button; also added extra bottom padding as a second
  safety net on the Books and Book Settings screens.
- Investigated the "plain sheet icon when unzipped" report: confirmed the
  actual installed app icon renders correctly (the wallet/shield logo) —
  the generic icon some people see is how certain file managers/PCs
  display an uninstalled `.apk` file before it's opened, which isn't
  something the app package can control.

## 2026-08-12 (later still) — Loan amortization calculator
- Added a Loan Calculator under Settings > General Settings — enter a loan
  amount, annual interest rate, and term (years or months) to get the
  monthly payment, total interest, and total amount paid
- Includes a collapsible full amortization schedule (per-payment principal,
  interest, and remaining balance), scrollable so it stays usable even for
  long terms like a 30-year mortgage
- Standalone tool, not tied to any book — uses the app's configured
  currency symbol

## 2026-08-12 (later still) — New app logo, "to buy / to pay for" sidebar, reminders
- Replaced the app icon/logo with the new wallet-and-shield artwork —
  regenerated the full Android adaptive icon set (legacy square, round, and
  adaptive foreground) at every density (mdpi–xxxhdpi), and updated the
  adaptive icon background color and web theme-color to match the new navy
- Added a global "To buy / to pay for" list — a running wishlist separate
  from any single book. It's reachable from a floating button on every
  screen (not tucked away in Settings, and it doesn't block the app behind
  it — it's a slide-over sidebar, not a full-screen modal). Supports
  add/edit/delete, marking items as bought/paid, and shows a running
  pending total
- Added Reminders under Settings — pick a date/time for any pending item
  on the to-buy/to-pay list and TallyBook schedules a native notification
  (via the new @capacitor/local-notifications dependency; falls back to a
  no-op in the browser preview). Added the Android permissions needed for
  scheduled notifications

## 2026-08-12 (later) — Entry detail, move/copy, app rename
- Renamed the app display name (Android app_name / title_activity_main) to
  "በጅሮንድ"
- Added an Entry Detail screen — tap an entry to see amount, receipt image,
  contact/category/remark, date/time, who created it and when, who last
  edited it and when, and (if applicable) where it was last transferred from
- Added move/copy entries between books — long-press (or right-click) an
  entry to move or copy it into another book in the same business; the
  entry is stamped with where/when it was transferred, and both books'
  activity logs get an entry
- Entries now track created-by/created-at separately from last-edited-by/
  edited-at (previously an edit just overwrote who added it)
- Added an entry-type toggle on the Edit Entry screen

## 2026-08-12 — Charts, search, multi-currency
- Added per-book balance show/hide toggle on the "Your Books" list (eye icon)
- Added a running balance caption under each entry ("Bal $X") showing the
  balance right after that transaction
- Added an expense breakdown pie chart per book, switchable "By Category"
  / "By Month" (new chart icon in the book header)
- Added search + Cash In/Out filter on the entries list (search icon in
  the book header)
- Added per-book currency — each book can use a different currency,
  independent of the others, set from Book Settings

## 2026-08-11 — Initial Android app
- Converted the TallyBook web artifact into a real installable Android app
  using Capacitor
- Swapped storage from the browser-only artifact API to on-device storage
  (`@capacitor/preferences`) — fully offline, data stays on the phone
- Set up a GitHub Actions workflow that compiles a debug APK automatically
  on every push (no local Android Studio/SDK needed)

## Earlier — TallyBook web artifact
- Built the original app as an interactive artifact in Claude: multi-business
  switching, books, cash in/out entries, member roles (Book Admin / Data
  Operator / Viewer) with a "view as" simulator, filtered reports (CSV +
  print-to-PDF), book activity log, move-book-between-businesses requests,
  app settings (categories, payment modes, currency)

## 2026-08-12 (cont.) — New app icon, darker in/out colors
- Replaced the placeholder Capacitor default icon with a custom logo — a
  white tally-mark glyph (four strokes + the crossing fifth) on the app's
  teal brand color, regenerated at every Android density for the adaptive
  icon (foreground + background), legacy square icon, and round icon
- Darkened the green (Cash In) and red (Cash Out) accent colors one shade
  throughout the app — icons, amounts, totals, and buttons — for better
  contrast; light background tints (the pale green/red chips) were left
  as-is

## 2026-08-12 (cont.) — Multi-select move/copy, working CSV/PDF export
- Added multi-select for move/copy: tap the checkmark icon in a book's
  header (or long-press an entry, same as before) to enter selection mode;
  tap entries to select/deselect, "Select All" toggles every currently
  visible (filtered/searched) entry, then "Move / Copy (N)" opens the same
  bottom-sheet, now handling any number of entries at once with a combined
  net-amount summary
- Fixed Download CSV and Print/Save as PDF, which weren't working in the
  installed Android app — Android's WebView doesn't support blob-URL
  download links or `window.print()`, which the code relied on. Exports
  now write the file to the app's cache via @capacitor/filesystem and hand
  it to the native Share sheet (@capacitor/share) so it can be saved to
  Downloads/Drive or shared directly; the PDF is now a real generated PDF
  (via jsPDF) instead of relying on print-to-PDF. Browser/dev preview still
  uses a plain blob download as a fallback, so `npm run dev` is unaffected.
  Registered both new plugins with `npx cap sync android` and added the
  Android 11+ `<queries>` manifest entry the Share chooser needs to list
  apps.
