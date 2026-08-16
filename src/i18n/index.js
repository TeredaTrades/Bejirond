import en from "./en";
import am from "./am";
import om from "./om";
import fr from "./fr";
import ar from "./ar";
import sw from "./sw";
import ti from "./ti";

// To add a new language: drop in a new file (e.g. fr.js) shaped like en.js —
// only the keys you have translations for; anything missing falls back to
// English automatically — then add one line each here and to LANGUAGES below.
export const TRANSLATIONS = { en, am, om, fr, ar, sw, ti };

// nativeName is what's shown in the language picker itself (each language's
// own name, in its own script), so a user can find their language even if
// the app is currently showing a script they can't read.
export const LANGUAGES = [
  { code: "en", nativeName: "English" },
  { code: "am", nativeName: "አማርኛ" },
  { code: "om", nativeName: "Afaan Oromoo" },
  { code: "ti", nativeName: "ትግርኛ" },
  { code: "fr", nativeName: "Français" },
  { code: "ar", nativeName: "العربية" },
  { code: "sw", nativeName: "Kiswahili" },
];

export const DEFAULT_LANGUAGE = "en";

function lookup(dict, path) {
  return path.split(".").reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), dict);
}

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, key) => (vars[key] !== undefined ? vars[key] : m));
}

// Returns a t(key, vars) function bound to the given language. Falls back to
// English for any key missing in that language, then to the key itself if
// it's missing from English too (so a typo'd key shows up visibly instead of
// silently rendering blank).
export function getTranslator(langCode) {
  const dict = TRANSLATIONS[langCode] || TRANSLATIONS[DEFAULT_LANGUAGE];
  return (key, vars) => {
    const val = lookup(dict, key) ?? lookup(TRANSLATIONS[DEFAULT_LANGUAGE], key) ?? key;
    return typeof val === "string" ? interpolate(val, vars) : val;
  };
}
