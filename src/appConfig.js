// ---------------------------------------------------------------------
// This file is the ONE thing that should differ between the `main` branch
// (the full paid bundle) and each `individual/<product>` branch (the free,
// single-tool, ad-supported apps). Everything else — screens, components,
// data logic — is shared code that can be merged from `individual-base`
// into every product branch without conflicts.
//
// To turn this codebase into a specific single-tool app, change
// APP_VARIANT below to that product's id and nothing else needs to change
// in App.jsx — the tab bar and Home screen read this value to decide what
// to show.
// ---------------------------------------------------------------------

// "bundle" | "expenses-manager" | "loan-calculator" | "budget" | "trip-organizer"
export const APP_VARIANT = "expenses-manager";

export const IS_BUNDLE = APP_VARIANT === "bundle";

// Catalog of the individual, single-tool apps. `playStoreUrl` is left null
// until each one has its own Android applicationId and Play Store listing
// (see NOTES.md — package IDs were deliberately not set up yet). Until
// then, the "Get" button on each row doesn't link anywhere yet.
// Display name/tagline are NOT here — they're fully localized and live in
// src/i18n/*.js under moreApps.products.<id>.{name,tagline}, looked up by
// id at render time so they follow the app's language setting.
export const PRODUCTS = [
  { id: "expenses-manager", playStoreUrl: null },
  { id: "loan-calculator", playStoreUrl: null },
  { id: "budget", playStoreUrl: null },
  { id: "trip-organizer", playStoreUrl: null },
  { id: "marketplace", playStoreUrl: null },
];

export const BUNDLE_PRODUCT = { id: "bundle", playStoreUrl: null };

export function productById(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}
