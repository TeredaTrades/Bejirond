# በጅሮንድ (Bejirond) — Android App

The standalone, single-tool Expenses Manager build of TallyBook — books,
multi-business, team roles, reports — packaged separately from the full
bundle app so both can be installed on the same phone without conflicting
(this build uses its own Android application ID,
`com.teredatrades.bejirond`, distinct from the bundle's
`com.teredatrades.tallybook`). Runs fully offline; all data is stored only
on your phone using Capacitor's on-device Preferences storage — nothing is
sent to any server.

This repo is a mirror of the `individual/expenses-manager` branch of the
main [`tallybook-app`](https://github.com/TeredaTrades/tallybook-app)
repo, kept separate so it can build and be distributed as its own APK.

## Get the APK onto your phone (no Android Studio needed)

Pushing to `main` here triggers `.github/workflows/build-apk.yml`,
   which installs everything and compiles the APK in GitHub's cloud
   (takes ~3-5 minutes). Watch it under the repo's **Actions** tab.
1. **Wait for the build.** Watch it under the repo's **Actions** tab
   (~3-5 minutes).
2. **Download the APK.** When the run finishes (green check), either open
   the run and download `Bejirond-debug-apk` from **Artifacts**, or check
   the repo's **Releases** page — the workflow also publishes a release
   with the APK attached.
3. **Install on your phone.** Transfer the `.apk` to your phone (email it
   to yourself, use a cloud drive, or a USB cable) and open it. Android
   will ask you to allow installs from this source the first time —
   approve that, then install normally.

That's it — no dev machine, no Android Studio, no SDK setup on your end.

## Notes

- This is a **debug build** (unsigned), which is fine for installing on
  your own device. If you ever want to publish it to the Play Store,
  that requires a signed **release** build and a Google Play developer
  account — a different process I can help with separately if you want it.
- All your books, entries, and settings are stored locally via
  `@capacitor/preferences`. Uninstalling the app deletes that data, so
  back up anything important (e.g. export a report) before uninstalling.
- To make changes later: edit files in `src/`, then repeat step 2's
  `git add / commit / push` — the workflow rebuilds the APK automatically.

## Local development (optional)

If you do have Node.js installed on your own computer:

```bash
npm install
npm run dev        # live preview in a browser
npm run build       # production web build
npx cap sync android # copy web build into the native project
```
