import { Preferences } from "@capacitor/preferences";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// Android sandboxes each app's storage — two separately-installed apps
// (e.g. the standalone Expenses Manager and the full bundle) can never read
// each other's Preferences directly, even though they share this codebase.
// So "bring my data into the bundle" has to be an explicit export-to-file /
// import-from-file step, not automatic detection.
//
// Which storage keys belong to each single-tool product. Used to scope
// exactly what an individual app's export contains, so importing e.g. an
// Expenses Manager export into the bundle only ever touches the bundle's
// "ledgers"/"entries:*"/"activity:*" keys — never its Budget or Trip
// Organizer data.
export const PRODUCT_DATA_SCOPES = {
  // Deliberately excludes "account" and "first-run-done" — those are the
  // per-device onboarding/PIN state (see ONBOARDING_GROUP in App.jsx), and
  // silently carrying one device's PIN onto another via a restored file
  // would be a surprise, not a convenience. Restoring a backup re-creates
  // everything else and leaves the person to set up (or skip) a PIN fresh.
  "expenses-manager": {
    exactKeys: ["ledgers", "app-settings", "profile", "planned-items", "app-theme", "app-language", "quick-access-bubble-on"],
    prefixes: ["entries:", "activity:"],
  },
  "budget": { exactKeys: ["budget-plan"], prefixes: [] },
  "trip-organizer": { exactKeys: ["trips"], prefixes: [] },
  // Loan Calculator doesn't persist anything between sessions today, so
  // there's nothing to export/import for it.
  "loan-calculator": { exactKeys: [], prefixes: [] },
};

async function keysForScope(scope) {
  const { keys } = await Preferences.keys();
  return keys.filter((k) => scope.exactKeys.includes(k) || scope.prefixes.some((p) => k.startsWith(p)));
}

export async function exportProductData(productId) {
  const scope = PRODUCT_DATA_SCOPES[productId];
  if (!scope) throw new Error(`Unknown product: ${productId}`);
  const keys = await keysForScope(scope);
  const data = {};
  for (const k of keys) {
    const r = await Preferences.get({ key: k });
    if (r && r.value != null) data[k] = JSON.parse(r.value);
  }
  const bundle = {
    kind: "beserond-data-export",
    product: productId,
    exportedAt: new Date().toISOString(),
    data,
  };
  const filename = `beserond-${productId}-export-${Date.now()}.json`;
  const json = JSON.stringify(bundle, null, 2);
  await Filesystem.writeFile({ path: filename, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
  await Share.share({ title: filename, url: uri, dialogTitle: "Save or share your export" });
  return bundle;
}

// Parses a File (from an <input type="file"> picker) into an export bundle,
// without writing anything yet — lets the caller show a confirmation
// ("Import N items from Expenses Manager?") before committing.
export function readExportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || parsed.kind !== "beserond-data-export" || !parsed.data) {
          reject(new Error("That doesn't look like a በጅሮንድ data export file."));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new Error("Couldn't read that file — is it a በጅሮንድ export?"));
      }
    };
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsText(file);
  });
}

// Merge is last-write-wins per top-level key (e.g. replaces "ledgers"
// wholesale) rather than a deep merge — good enough for the common case of
// bringing data into a bundle install that doesn't have any of that
// product's data yet. If the bundle already has data for that product,
// the caller should warn before calling this.
export async function importProductData(exportBundle) {
  const entries = Object.entries(exportBundle.data);
  for (const [key, value] of entries) {
    await Preferences.set({ key, value: JSON.stringify(value) });
  }
  return { product: exportBundle.product, keysImported: entries.length };
}

// Whether the local install already has data for a given product — used to
// warn before an import would overwrite it.
export async function hasExistingData(productId) {
  const scope = PRODUCT_DATA_SCOPES[productId];
  if (!scope) return false;
  const keys = await keysForScope(scope);
  return keys.length > 0;
}
