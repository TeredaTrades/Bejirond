import { Preferences } from "@capacitor/preferences";
import { Share } from "@capacitor/share";

// On-device only, same as everything else in the app — no backend, no
// network calls. Suggestions sit in local storage until the person taps
// "Share Suggestions", which hands a plain-text summary to the OS share
// sheet (email, WhatsApp, etc.) so THEY choose where it goes.
const KEY = "translation-suggestions";

export async function getSuggestions() {
  try {
    const r = await Preferences.get({ key: KEY });
    return r && r.value != null ? JSON.parse(r.value) : [];
  } catch {
    return [];
  }
}

async function setSuggestions(list) {
  try {
    await Preferences.set({ key: KEY, value: JSON.stringify(list) });
  } catch (e) {
    console.error("translation suggestion storage failed", e);
  }
}

export async function addSuggestion({ language, languageName, text, suggestion, note }) {
  const list = await getSuggestions();
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    language,
    languageName,
    text: text.trim(),
    suggestion: suggestion.trim(),
    note: (note || "").trim(),
    createdAt: new Date().toISOString(),
  };
  const next = [item, ...list];
  await setSuggestions(next);
  return next;
}

export async function removeSuggestion(id) {
  const list = await getSuggestions();
  const next = list.filter((s) => s.id !== id);
  await setSuggestions(next);
  return next;
}

// Groups by language so a reviewer working through these can go
// language-by-language instead of hunting through one flat list.
export async function shareSuggestions(list) {
  const byLang = {};
  for (const s of list) {
    const label = s.languageName || s.language;
    (byLang[label] = byLang[label] || []).push(s);
  }
  const sections = Object.entries(byLang).map(([label, items]) => {
    const lines = items.map((s, i) => {
      const parts = [`${i + 1}. "${s.text}"`, `   → ${s.suggestion}`];
      if (s.note) parts.push(`   note: ${s.note}`);
      return parts.join("\n");
    });
    return `${label} (${items.length})\n${lines.join("\n\n")}`;
  });
  const body = `Bejirond translation suggestions — ${list.length} total\n\n${sections.join("\n\n---\n\n")}`;
  await Share.share({
    title: "Bejirond translation suggestions",
    text: body,
    dialogTitle: "Send translation suggestions",
  });
}
