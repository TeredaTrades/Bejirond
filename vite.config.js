import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// Used to detect "this is a newer build than what this device last saw" (see
// APP_BUILD usage in App.jsx, around the once-per-update About-splash logic).
// Deliberately derived from the actual git commit rather than a manually
// maintained version number — every real code change is automatically a new
// commit, so there's no separate "remember to bump the version" step for
// this to keep working. Falls back to a fixed string if git isn't available
// for some reason (should never happen in either build path: local build or
// the Build Android APK workflow, both of which checkout the repo first).
function currentBuildId() {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    __APP_BUILD__: JSON.stringify(currentBuildId()),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
