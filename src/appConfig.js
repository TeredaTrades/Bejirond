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
export const PRODUCTS = [
  {
    id: "expenses-manager",
    name: "በጅሮንድ Expenses Manager",
    tagline: "Track cash in and out across businesses and books",
    playStoreUrl: null,
  },
  {
    id: "loan-calculator",
    name: "በጅሮንድ Loan Calculator",
    tagline: "Work out loan payments, interest, and fees",
    playStoreUrl: null,
  },
  {
    id: "budget",
    name: "በጅሮንድ Budget",
    tagline: "Plan and track a monthly budget",
    playStoreUrl: null,
  },
  {
    id: "trip-organizer",
    name: "አጋፋሪ",
    tagline: "Your one-stop shop for experiences & vibes",
    playStoreUrl: null,
  },
  {
    id: "marketplace",
    name: "ገበያ",
    tagline: "Buy & sell marketplace",
    playStoreUrl: null,
  },
];

export const BUNDLE_PRODUCT = {
  id: "bundle",
  name: "በጅሮንድ Finances",
  tagline: "Every tool together, no ads",
  playStoreUrl: null,
};

export function productById(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}
