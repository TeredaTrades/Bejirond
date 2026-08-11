# TallyBook — Android App

A cash-in/cash-out ledger app (books, multi-business, team roles, reports)
that runs fully offline. All data is stored only on your phone using
Capacitor's on-device Preferences storage — nothing is sent to any server.

## Get the APK onto your phone (no Android Studio needed)

1. **Create a new GitHub repo** (github.com → New repository). Any name, e.g. `tallybook-app`.
2. **Push this folder to it.** From inside this folder:
   ```bash
   git init
   git add .
   git commit -m "TallyBook Android app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/tallybook-app.git
   git push -u origin main
   ```
3. **Wait for the build.** Pushing triggers `.github/workflows/build-apk.yml`,
   which installs everything and compiles the APK in GitHub's cloud
   (takes ~3-5 minutes). Watch it under the repo's **Actions** tab.
4. **Download the APK.** When the run finishes (green check), open it,
   scroll to **Artifacts**, and download `TallyBook-debug-apk` — it's a
   zip containing `app-debug.apk`.
5. **Install on your phone.** Transfer the `.apk` to your phone (email it
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
