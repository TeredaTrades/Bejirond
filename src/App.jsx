import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Plus, Minus, ChevronRight, ChevronDown, ArrowLeft, X, Settings as SettingsIcon,
  Users, FileText, Search, MoreVertical, Building2, UserPlus, Info, Smartphone,
  Share2, HelpCircle, Wallet, TrendingUp, TrendingDown, Calendar,
  Clock, Trash2, Download, Printer, Eye, EyeOff, ShieldCheck, Check, ArrowRightLeft,
  Loader2, Inbox, ChevronLeft, PieChart as PieChartIcon, SlidersHorizontal, Camera, Paperclip,
  CheckSquare, CheckCircle2, Circle, ClipboardList, Bell, BellOff, BellRing, Calculator,
  VolumeX, Palette, Sun, Moon, LayoutGrid,
  Upload, Sparkles, Move, Languages, MessageSquarePlus,
} from "lucide-react";
import { Preferences } from "@capacitor/preferences";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { LocalNotifications } from "@capacitor/local-notifications";
import { App as CapacitorApp } from "@capacitor/app";
import jsPDF from "jspdf";
import { APP_VARIANT, IS_BUNDLE, PRODUCTS, BUNDLE_PRODUCT, productById } from "./appConfig";
import { LANGUAGES, DEFAULT_LANGUAGE, getTranslator } from "./i18n";
import { exportProductData, readExportFile, importProductData, hasExistingData, PRODUCT_DATA_SCOPES } from "./dataPortability";
// pdfjs-dist (~110KB gzipped) is only needed by the rare person recovering
// entries from an old PDF report, so it's dynamically imported inside
// onImportPdf below rather than pulled into the main bundle everyone
// downloads on every app launch.
import { getSuggestions, addSuggestion, removeSuggestion, shareSuggestions } from "./translationSuggestions";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

// Native-only local plugin (no JS package — implemented directly in the Android project,
// see android/app/src/main/java/com/teredatrades/bejirond/TallyWidgetPlugin.java) that
// backs the Home screen widget and floating-icon Quick Access options. Every method is a
// no-op that resolves harmlessly on web/dev preview and is wrapped in try/catch at the
// call sites below, so a device that doesn't support one of these (or the plugin failing
// to register for any reason) never breaks the rest of the app.
const TallyWidget = registerPlugin("TallyWidget");

// ---------- constants ----------
const DEFAULT_CATEGORIES = ["Home", "Electronics", "Food", "Salary", "Rent", "Transport", "Utilities", "Other"];
const DEFAULT_PAYMENT_MODES = ["Cash", "Telebirr", "CBE Birr", "Coopay", "M-Pesa", "Online", "Card", "Cheque"];
// Modes added to DEFAULT_PAYMENT_MODES after the original release. New defaults
// only apply to brand-new installs (see DEFAULT_APP_SETTINGS above) — an
// existing install already has its own persisted "app-settings" record, and
// the shallow-merge on load (`{ ...DEFAULT_APP_SETTINGS, ...stored }`) keeps
// the stored paymentModes array as-is rather than pulling in new entries. This
// list drives a one-time migration (see the initial-load effect) that appends
// any of these the user doesn't already have — and won't re-add one a user
// has deliberately removed, since it only ever runs once per install.
const PAYMENT_MODES_MIGRATION_V2 = ["Telebirr", "CBE Birr", "Coopay", "M-Pesa"];
const CURRENCIES = { "$": "USD", "Br": "ETB", "₹": "INR", "€": "EUR", "£": "GBP" };
// calendarType: "gregorian" | "ethiopian" — which calendar dates are *displayed*
// in (all dates are still stored internally as plain Gregorian ISO strings, so
// switching this never touches saved data, only how it's shown).
// timeFormat: "12h" | "24h" — whether times are shown with AM/PM or 24-hour.
const DEFAULT_APP_SETTINGS = { categories: DEFAULT_CATEGORIES, paymentModes: DEFAULT_PAYMENT_MODES, currency: "Br", calendarType: "gregorian", timeFormat: "12h" };
const ROLES = ["Book Admin", "Data Operator", "Viewer"];
const BOOK_TEMPLATE_KEYS = ["salesLedger", "bankReconciliation", "sharedCashbook", "payrollStaffExpenses"];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const todayStr = () => new Date().toISOString().slice(0, 10);
// 24-hour "HH:MM" — what the native <input type="time"> picker needs/returns.
const nowTimeStr24 = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
// Normalizes a stored time value (legacy free-typed "9:00 PM" strings, or the current
// 24h "HH:MM" from the native time picker) into "HH:MM" for the <input type="time">
// field's value. Anything unrecognized falls back to the current time rather than
// leaving the picker blank.
const to24h = (t) => {
  const raw = (t || "").trim();
  const m24 = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (m24) return `${m24[1].padStart(2, "0")}:${m24[2]}`;
  const mAmPm = /^(\d{1,2}):(\d{2})\s?(AM|PM)$/i.exec(raw);
  if (mAmPm) {
    let h = parseInt(mAmPm[1], 10) % 12;
    if (/PM/i.test(mAmPm[3])) h += 12;
    return `${String(h).padStart(2, "0")}:${mAmPm[2]}`;
  }
  return nowTimeStr24();
};
// BCP-47 locale tag for each app language, used for Intl date/time formatting
// so day/month names (and, for Ethiopic dates, the Amharic/Oromo/Tigrinya
// month names) show in the app's current language instead of always English.
const INTL_LOCALE = { en: "en", am: "am", om: "om", ti: "ti", fr: "fr", ar: "ar", sw: "sw" };
// Builds the Intl locale string for a language + calendar preference. The
// "-u-ca-ethiopic" extension makes Intl compute the date in the Ethiopian
// calendar (13 months, ~7-8 years behind Gregorian) while everything else
// about the app (storage, sorting, the native date input) stays Gregorian —
// only the *display* changes.
const intlLocale = (language, calendarType) => {
  const base = INTL_LOCALE[language] || "en";
  return calendarType === "ethiopian" ? `${base}-u-ca-ethiopic` : base;
};
// Formats a stored time value (24h "HH:MM" from the native time picker, or a
// legacy free-typed "9:00 PM" string) for display, honoring the 12h/24h
// preference and using the app language's own AM/PM-equivalent wording.
const fmtTime = (time, pref = {}) => {
  const { language = "en", timeFormat = "12h" } = pref;
  const t24 = to24h(time);
  const [hh, mm] = t24.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return "";
  const d = new Date(); d.setHours(hh, mm, 0, 0);
  return d.toLocaleTimeString(INTL_LOCALE[language] || "en", {
    hour: timeFormat === "24h" ? "2-digit" : "numeric", minute: "2-digit",
    hourCycle: timeFormat === "24h" ? "h23" : "h12",
  });
};
const fmtDate = (iso, pref = {}) => {
  const { language = "en", calendarType = "gregorian" } = pref;
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(intlLocale(language, calendarType), { day: "2-digit", month: "short", year: "numeric" });
};
// Turns an entry's date + "9:00 PM"-style time into a real, sortable Date.
const entryDateTime = (e) => {
  const d = new Date((e.date || todayStr()) + "T00:00:00");
  const raw = (e.time || "").trim();
  const m = /^(\d{1,2}):(\d{2})\s?(AM|PM)$/i.exec(raw);
  if (m) {
    let h = parseInt(m[1], 10) % 12;
    if (/PM/i.test(m[3])) h += 12;
    d.setHours(h, parseInt(m[2], 10), 0, 0);
  } else {
    const m24 = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (m24) d.setHours(parseInt(m24[1], 10), parseInt(m24[2], 10), 0, 0);
  }
  return d;
};
const bookCurrency = (book, appSettings) => (book && book.currency) || appSettings.currency;
const fmtDateTime = (iso, pref = {}) => {
  if (!iso) return "";
  const { language = "en", calendarType = "gregorian", timeFormat = "12h" } = pref;
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString(intlLocale(language, calendarType), { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = d.toLocaleTimeString(INTL_LOCALE[language] || "en", {
    hour: timeFormat === "24h" ? "2-digit" : "numeric", minute: "2-digit",
    hourCycle: timeFormat === "24h" ? "h23" : "h12",
  });
  return `${dateStr} · ${timeStr}`;
};
const CHART_COLORS = ["#0f766e", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#65a30d", "#0284c7", "#ea580c"];

// ---------- file export (CSV / PDF) ----------
// Android's WebView can't do blob-URL <a download> links or window.print(), so on
// a native build we write the file to cache and hand it to the OS share sheet
// (the user can then save to Downloads, Drive, WhatsApp, etc). In a plain browser
// (npm run dev / preview) we fall back to a normal blob download, which still works.
async function saveAndShareFile({ filename, data, mimeType, base64 = false }) {
  if (Capacitor.isNativePlatform()) {
    const writeOpts = base64
      ? { path: filename, data, directory: Directory.Cache }
      : { path: filename, data, directory: Directory.Cache, encoding: Encoding.UTF8 };
    await Filesystem.writeFile(writeOpts);
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ title: filename, url: uri, dialogTitle: "Save or share" });
  } else {
    const blob = base64
      ? new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: mimeType })
      : new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// Builds a simple paginated PDF report and returns it as a base64 string.
function buildReportPdfBase64({ title, subtitle, totalIn, totalOut, cur, headers, rows }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 40;
  const rightEdge = 555;
  let y = 50;

  doc.setFontSize(16);
  doc.text(String(title || "Report"), marginX, y);
  y += 20;

  if (subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(String(subtitle), marginX, y);
    doc.setTextColor(0);
    y += 22;
  }

  doc.setFontSize(11);
  doc.setTextColor(5, 150, 105); // emerald
  doc.text(`Total In: ${cur}${totalIn.toLocaleString()}`, marginX, y);
  doc.setTextColor(220, 38, 38); // rose
  doc.text(`Total Out: ${cur}${totalOut.toLocaleString()}`, marginX + 220, y);
  doc.setTextColor(0);
  y += 22;

  const colWidth = (rightEdge - marginX) / headers.length;
  const colX = headers.map((_, i) => marginX + colWidth * i);

  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  headers.forEach((h, i) => doc.text(String(h), colX[i], y));
  doc.setFont(undefined, "normal");
  y += 6;
  doc.setDrawColor(200);
  doc.line(marginX, y, rightEdge, y);
  y += 14;

  const pageHeight = doc.internal.pageSize.getHeight();
  rows.forEach((row) => {
    if (y > pageHeight - 40) {
      doc.addPage();
      y = 50;
    }
    row.forEach((cell, i) => doc.text(String(cell ?? ""), colX[i], y));
    y += 16;
  });

  if (rows.length === 0) {
    doc.setTextColor(150);
    doc.text("No entries match these filters.", marginX, y);
  }

  return doc.output("datauristring").split(",")[1];
}

// ---------- CSV import (entries) ----------
// Parses CSV text into rows of string cells. Handles RFC4180-style quoting
// (quoted fields, embedded commas, embedded newlines, "" as an escaped quote)
// since that's exactly how downloadCsv above writes every field — every cell
// is always wrapped in quotes, so this only needs to handle that one style
// reliably rather than every CSV dialect in the wild.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell); cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Expects exactly the header written by downloadCsv's "all entries" export:
// Date, Time, Type, Amount, Contact, Category, Payment Mode, Remark, Added By.
// Only that format is supported — the Category/Payment Mode summary exports
// are aggregate totals, not individual entries, so there's nothing to
// reconstruct from those. Returns { entries, error }; error is a translated
// message if the file doesn't match, entries is [] in that case.
const ENTRIES_CSV_HEADER = ["Date", "Time", "Type", "Amount", "Contact", "Category", "Payment Mode", "Remark", "Added By"];
function parseEntriesCsv(text, t) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length === 0) return { entries: [], error: t("bookSettings.importCsvErrorEmpty") };
  const header = rows[0].map((h) => h.trim());
  const headerOk = ENTRIES_CSV_HEADER.every((h, i) => (header[i] || "").toLowerCase() === h.toLowerCase());
  if (!headerOk) return { entries: [], error: t("bookSettings.importCsvErrorFormat") };
  const entries = [];
  for (const r of rows.slice(1)) {
    if (r.every((c) => c === "")) continue;
    const [date, time, typeLabel, amountStr, contact, category, paymentMode, remark, addedBy] = r;
    const amount = Number(String(amountStr).replace(/,/g, ""));
    if (!date || !Number.isFinite(amount)) continue;
    entries.push({
      id: uid(),
      type: /out/i.test(typeLabel) ? "out" : "in",
      date, time: time || "",
      amount,
      contact: contact || "", category: category || "", paymentMode: paymentMode || "Cash",
      remark: remark || "", receipt: null,
      addedBy: addedBy || undefined,
      createdAt: new Date().toISOString(),
    });
  }
  return { entries, error: entries.length === 0 ? t("bookSettings.importCsvErrorNoRows") : null };
}

// On-device storage only — Capacitor Preferences persists to the phone's
// local app storage. Nothing is sent over a network; the app works fully offline.
async function storeGet(key, fallback) {
  try {
    const r = await Preferences.get({ key });
    return r && r.value != null ? JSON.parse(r.value) : fallback;
  } catch { return fallback; }
}
async function storeSet(key, value) {
  try { await Preferences.set({ key, value: JSON.stringify(value) }); } catch (e) { console.error("storage set failed", key, e); }
}

// ---------- onboarding state (account / first-run-done) ----------
// IMPORTANT: this deliberately does NOT use Capacitor Preferences' `group`
// option. That option is only applied via a separate, plugin-instance-wide
// `Preferences.configure({ group })` call — it is NOT a per-call parameter
// on get()/set(), even though the JS types on those methods don't stop you
// from passing one. Passing `group` directly to get()/set() is silently
// ignored on Android (confirmed against the plugin's native source and the
// official GetOptions/SetOptions type defs, which only declare `key`/
// `value` — no `group` field). An earlier attempt at this fix did exactly
// that and looked correct in review, but never actually isolated onboarding
// data into a separate file — account/first-run-done kept landing in the
// same default file as everything else, so Android's Auto Backup kept
// silently restoring them on reinstall and skipping onboarding entirely,
// same as before that "fix" ever landed.
//
// Real fix: store onboarding state in its own file via Filesystem instead
// of Preferences, so it can be excluded from Android's backup rules by file
// path (domain="file") rather than by a Preferences group that doesn't
// actually create a separate file per call.
const ONBOARDING_FILE = "onboarding-state.json";
async function onboardingGet(key, fallback) {
  try {
    const { data } = await Filesystem.readFile({ path: ONBOARDING_FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
    const all = JSON.parse(data);
    return key in all ? all[key] : fallback;
  } catch { return fallback; }
}
async function onboardingSet(key, value) {
  let all = {};
  try {
    const { data } = await Filesystem.readFile({ path: ONBOARDING_FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
    all = JSON.parse(data);
  } catch { /* file doesn't exist yet — start fresh */ }
  all[key] = value;
  try {
    await Filesystem.writeFile({ path: ONBOARDING_FILE, directory: Directory.Data, data: JSON.stringify(all), encoding: Encoding.UTF8 });
  } catch (e) { console.error("onboarding storage set failed", key, e); }
}

// ---------- reminders (things to buy / to pay for) ----------
// Native local notifications on Android via @capacitor/local-notifications.
// In the browser preview (npm run dev) these calls are no-ops so the app keeps working.
const REMINDER_CHANNEL_ID = "tallybook-reminders";
const REMINDER_SOUND_FILE = "reminder_alarm.wav"; // android/app/src/main/res/raw/reminder_alarm.wav

function notifIdFor(itemId) {
  let h = 0;
  for (let i = 0; i < itemId.length; i++) h = (h * 31 + itemId.charCodeAt(i)) >>> 0;
  return h % 2147483647;
}
async function checkNotifPermission() {
  if (!Capacitor.isNativePlatform()) return "granted";
  try { return (await LocalNotifications.checkPermissions()).display; } catch { return "denied"; }
}
async function requestNotifPermissionNative() {
  if (!Capacitor.isNativePlatform()) return "granted";
  try { return (await LocalNotifications.requestPermissions()).display; } catch { return "denied"; }
}
// Creates (or updates) a dedicated high-importance channel so reminders play
// a distinct alarm-like sound + strong vibration and pop up as a heads-up
// banner, instead of a silent line in the notification shade. Android only
// lets a channel's sound/importance be set the first time it's created, so
// this mainly takes effect on a fresh install.
async function ensureReminderChannel() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.createChannel({
      id: REMINDER_CHANNEL_ID,
      name: "Payment & item reminders",
      description: "Alerts for things you scheduled a reminder for on your to-buy/to-pay list",
      importance: 5, // max — heads-up banner + sound even if the phone is locked
      visibility: 1,
      sound: REMINDER_SOUND_FILE,
      vibration: true,
      lights: true,
    });
  } catch (e) { console.error("create reminder channel failed", e); }
}
// ---------- Quick Access: Home screen widget + floating icon ----------
// Pushes a short "net balance" summary text to the native widget/bubble layer.
// Fire-and-forget: called opportunistically whenever books/entries change so the
// widget stays fresh next time it redraws, but nothing in the app waits on it.
async function pushWidgetBalance(ledgers, appSettings) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const active = ledgers?.[0];
    if (!active) { await TallyWidget.updateBalance({ text: "No ledgers yet" }); return; }
    let total = 0;
    for (const biz of ledgers) {
      for (const bk of biz.books) {
        const es = await storeGet(`entries:${bk.id}`, []);
        total += es.reduce((s, e) => s + (e.type === "in" ? e.amount : -e.amount), 0);
      }
    }
    const cur = appSettings?.currency || "Br";
    const text = `${total >= 0 ? "+" : "-"}${cur}${Math.abs(total).toLocaleString()}`;
    await TallyWidget.updateBalance({ text });
  } catch (e) { /* widget is a nice-to-have — never let this affect the app */ }
}
async function schedulePlannedReminder(item) {
  if (!Capacitor.isNativePlatform() || !item.reminderAt) return;
  const at = new Date(item.reminderAt);
  if (isNaN(at.getTime()) || at.getTime() <= Date.now()) return;
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: notifIdFor(item.id),
        title: `Reminder: ${item.desc}`,
        body: `Anticipated ${item.amount ? Number(item.amount).toLocaleString() : "0"} · ${item.category} — tap for details`,
        schedule: { at, allowWhileIdle: true },
        channelId: REMINDER_CHANNEL_ID,
        sound: REMINDER_SOUND_FILE,
        extra: { plannedItemId: item.id },
      }],
    });
  } catch (e) { console.error("schedule reminder failed", e); }
}
async function cancelPlannedReminder(item) {
  if (!Capacitor.isNativePlatform()) return;
  try { await LocalNotifications.cancel({ notifications: [{ id: notifIdFor(item.id) }] }); } catch {}
}

// ---------- small UI atoms ----------
function Chip({ active, children, onClick, tone = "teal" }) {
  const toneMap = {
    teal: active ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-600 border-slate-300",
    emerald: active ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-slate-600 border-slate-300",
    rose: active ? "bg-rose-700 text-white border-rose-700" : "bg-white text-slate-600 border-slate-300",
  };
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-full text-sm border font-medium transition-colors ${toneMap[tone]}`}>
      {children}
    </button>
  );
}

function TopHeader({ title, subtitle, onBack, right, ctx }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white sticky top-0 z-10">
      {onBack && (
        <button onClick={onBack} className="p-1 -ml-1 text-slate-700 hover:bg-slate-100 rounded-full">
          <ArrowLeft size={20} />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-900 truncate">{title}</div>
        {subtitle && <div className="text-xs text-slate-500 truncate">{subtitle}</div>}
      </div>
      {right}
      {ctx?.persistTheme && (
        <button onClick={() => ctx.persistTheme(ctx.theme === "dark" ? "light" : "dark")}
          className="shrink-0 w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 active:scale-95 transition-transform"
          title={ctx.theme === "dark" ? "Switch to light" : "Switch to dark"}>
          {ctx.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      )}
    </div>
  );
}

// Wireframe-style app-logo glyph used wherever a "cashbook" icon is needed
// (splash/onboarding screens, Cashbooks nav tab, book list rows, empty
// states). Renders the real Bejirond logo, tinted green to sit alongside
// the app's teal accents, instead of a generic bookmark/wallet line icon.
// Accepts the same size/className shape as a lucide icon so it drops into
// icon={...} slots (e.g. EmptyState, nav config) without special-casing.
function AppLogoIcon({ size = 24, className = "", style = {} }) {
  return (
    <img
      src="/logo-tinted.png"
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain", display: "inline-block", borderRadius: "22%", ...style }}
    />
  );
}

function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 text-slate-400">
      <Icon size={36} className="mb-3 text-slate-300" />
      <div className="font-medium text-slate-500">{title}</div>
      {hint && <div className="text-sm mt-1 max-w-[240px]">{hint}</div>}
    </div>
  );
}

// ---------- Custom date/time pickers ----------
// Native <input type="date">/<input type="time">/<input type="datetime-local">
// render their picker UI in the *device's* language, ignoring the app's own
// language setting — so someone running the app in Amharic still gets English
// month names and an English AM/PM toggle the moment they tap to pick a date.
// These components render entirely in React/Tailwind instead, using the same
// Intl machinery as fmtDate/fmtTime above, so the picker always matches the
// app's chosen language regardless of device language. They stay Gregorian
// (matching how dates are always stored) even when the display calendar is
// set to Ethiopian — the Ethiopian-calendar *picker* itself is a bigger,
// separate piece of work than the language gap this fixes.
function CustomDatePicker({ value, onChange, language = "en", className }) {
  const [open, setOpen] = useState(false);
  const locale = INTL_LOCALE[language] || "en";
  const base = value ? new Date(value + "T00:00:00") : new Date();
  const [viewYear, setViewYear] = useState(base.getFullYear());
  const [viewMonth, setViewMonth] = useState(base.getMonth());

  useEffect(() => {
    const d = value ? new Date(value + "T00:00:00") : new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }, [value]);

  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(viewYear, viewMonth, 1));
  const weekdayLabels = useMemo(() => {
    // Jan 4 1970 was a Sunday — walking 7 days from there gives Sun..Sat in
    // this locale's own weekday names, independent of what day today is.
    const labels = [];
    for (let i = 0; i < 7; i++) labels.push(new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(1970, 0, 4 + i)));
    return labels;
  }, [locale]);

  const startWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const todayIso = todayStr();

  const pick = (day) => {
    onChange(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    setOpen(false);
  };
  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); } else setViewMonth((m) => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); } else setViewMonth((m) => m + 1); };

  const displayText = value ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value + "T00:00:00")) : "";

  return (
    <div className="relative flex-1 min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={className || "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-left truncate"}>
        {displayText}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-3 w-64">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={prevMonth} className="p-1 text-slate-500 hover:bg-slate-100 rounded-full"><ChevronLeft size={16} /></button>
              <div className="text-sm font-semibold text-slate-800">{monthLabel} {viewYear}</div>
              <button type="button" onClick={nextMonth} className="p-1 text-slate-500 hover:bg-slate-100 rounded-full"><ChevronRight size={16} /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {weekdayLabels.map((w, i) => <div key={i} className="text-[10px] text-slate-400 text-center">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (d === null) return <div key={i} />;
                const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                const isSelected = iso === value;
                const isToday = iso === todayIso;
                return (
                  <button type="button" key={i} onClick={() => pick(d)}
                    className={`text-xs rounded-full h-7 w-7 flex items-center justify-center ${isSelected ? "bg-teal-700 text-white" : isToday ? "border border-teal-500 text-teal-700" : "text-slate-700 hover:bg-slate-100"}`}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CustomTimePicker({ value, onChange, language = "en", timeFormat = "12h", className }) {
  const [open, setOpen] = useState(false);
  const locale = INTL_LOCALE[language] || "en";
  const t24 = to24h(value);
  const [hh24, mm] = t24.split(":").map((n) => parseInt(n, 10));
  const isPM = hh24 >= 12;
  const hour12 = (hh24 % 12) || 12;

  const periodLabel = (pm) => new Intl.DateTimeFormat(locale, { hour: "numeric", hourCycle: "h12" })
    .formatToParts(new Date(2024, 0, 1, pm ? 21 : 9)).find((p) => p.type === "dayPeriod")?.value || (pm ? "PM" : "AM");

  const setHour = (h) => {
    const newHH24 = timeFormat === "24h" ? h : (h % 12) + (isPM ? 12 : 0);
    onChange(`${String(newHH24).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  };
  const setMinute = (m) => onChange(`${String(hh24).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  const setPeriod = (pm) => {
    const newHH24 = (hour12 % 12) + (pm ? 12 : 0);
    onChange(`${String(newHH24).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  };

  const displayText = fmtTime(value, { language, timeFormat });

  return (
    <div className="relative flex-1 min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={className || "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-left truncate"}>
        {displayText}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-3 flex items-center gap-2 right-0">
            <select value={timeFormat === "24h" ? hh24 : hour12} onChange={(e) => setHour(parseInt(e.target.value, 10))}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white">
              {(timeFormat === "24h" ? Array.from({ length: 24 }, (_, i) => i) : Array.from({ length: 12 }, (_, i) => i + 1)).map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}</option>
              ))}
            </select>
            <span className="text-slate-400">:</span>
            <select value={mm} onChange={(e) => setMinute(parseInt(e.target.value, 10))}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white">
              {Array.from({ length: 60 }, (_, i) => i).map((m) => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
            </select>
            {timeFormat !== "24h" && (
              <div className="flex flex-col gap-1">
                <button type="button" onClick={() => setPeriod(false)} className={`text-xs px-2 py-1 rounded ${!isPM ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600"}`}>{periodLabel(false)}</button>
                <button type="button" onClick={() => setPeriod(true)} className={`text-xs px-2 py-1 rounded ${isPM ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600"}`}>{periodLabel(true)}</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Combines the two above for the reminders screen's single "pick a date and time"
// field. Keeps the same contract the native <input type="datetime-local"> had:
// value/onChange work in local time, producing/consuming a UTC ISO string (or null).
function CustomDateTimePicker({ valueIso, onChange, language = "en", timeFormat = "12h" }) {
  const local = valueIso ? new Date(valueIso) : null;
  const datePart = local ? `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}` : "";
  const timePart = local ? `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}` : "09:00";

  const commit = (nextDate, nextTime) => {
    if (!nextDate) { onChange(null); return; }
    const [y, mo, d] = nextDate.split("-").map(Number);
    const [hh, min] = (nextTime || "09:00").split(":").map(Number);
    onChange(new Date(y, mo - 1, d, hh, min, 0, 0).toISOString());
  };

  const fieldClass = "flex-1 min-w-0 border border-slate-300 rounded-lg px-2.5 py-2 text-sm bg-white text-left truncate";
  return (
    <div className="flex gap-2 flex-1 min-w-0">
      <CustomDatePicker value={datePart} onChange={(d) => commit(d, timePart)} language={language} className={fieldClass} />
      <CustomTimePicker value={timePart} onChange={(tm) => commit(datePart || todayStr(), tm)} language={language} timeFormat={timeFormat} className={fieldClass} />
    </div>
  );
}

// Evaluates a plain arithmetic expression (+ - * / ( ) and decimals only — nothing else is ever
// allowed through), so users can type e.g. "1200+350-40" straight into an amount field.
function safeEvalMath(expr) {
  const cleaned = (expr || "").trim();
  if (!cleaned) return null;
  if (!/^[0-9+\-*/(). ]+$/.test(cleaned)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${cleaned})`)();
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

// Amount input that accepts typed math (e.g. "500+120-30") and also has an expandable
// tap calculator for doing small add/subtract adjustments without leaving the field.
function AmountInput({ value, onChange, currencySymbol = "", placeholder = "0", autoFocus = false, calcTitle = "Calculator" }) {
  const [raw, setRaw] = useState(value != null && value !== "" ? String(value) : "");
  const [calcOpen, setCalcOpen] = useState(false);
  const hasOperator = /[+\-*/]/.test(raw.slice(1)); // ignore a leading minus sign
  const preview = hasOperator ? safeEvalMath(raw) : null;

  const commit = (text) => {
    setRaw(text);
    const evaluated = /[+\-*/]/.test(text.slice(1)) ? safeEvalMath(text) : (text === "" ? "" : Number(text));
    if (evaluated === null) return; // don't clobber the form value with an unparsable expression yet
    onChange(evaluated === "" ? "" : String(evaluated));
  };

  const tap = (t) => {
    if (t === "C") { commit(""); return; }
    if (t === "⌫") { commit(raw.slice(0, -1)); return; }
    if (t === "=") {
      const evaluated = safeEvalMath(raw);
      if (evaluated !== null) commit(String(evaluated));
      return;
    }
    commit(raw + t);
  };

  return (
    <div>
      <div className="relative">
        {currencySymbol && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold pointer-events-none">{currencySymbol}</span>}
        <input autoFocus={autoFocus} type="text" inputMode="decimal" value={raw}
          onChange={(e) => commit(e.target.value)}
          className={`w-full border-2 border-teal-600 rounded-lg ${currencySymbol ? "pl-9" : "pl-3"} pr-10 py-2 text-lg font-semibold`}
          placeholder={placeholder} />
        <button type="button" onClick={() => setCalcOpen((v) => !v)}
          className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded ${calcOpen ? "text-teal-700" : "text-slate-400"}`} title={calcTitle}>
          <Calculator size={18} />
        </button>
      </div>
      {preview !== null && (
        <div className="text-xs text-teal-700 mt-1 font-medium">= {preview.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
      )}
      {calcOpen && (
        <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-2 space-y-1.5">
          <div className="grid grid-cols-4 gap-1.5">
            {["7", "8", "9", "⌫", "4", "5", "6", "/", "1", "2", "3", "*", "C", "0", ".", "+"].map((k) => (
              <button key={k} type="button" onClick={() => tap(k)}
                className="py-2.5 rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-700">
                {k}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1">
            <button type="button" onClick={() => tap("-")}
              className="py-2 rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-700 mb-1.5">−</button>
            <button type="button" onClick={() => tap("=")}
              className="py-2.5 rounded-lg text-sm font-semibold bg-teal-700 text-white">=</button>
          </div>
        </div>
      )}
    </div>
  );
}

function BottomNav({ tab, setTab, t }) {
  const items = [
    // The Expenses Manager standalone build drops Home entirely (see App's initial
    // tab/stack below) — it lands straight on the ledger selector, so there's no
    // Home screen to link to from here.
    // Only the bundle (or the Expenses Manager standalone build) has a
    // dedicated Cashbooks tab — other single-tool builds reach their one
    // tool from the Home card instead.
    (IS_BUNDLE || APP_VARIANT === "expenses-manager") && { id: "books", label: t("nav.cashbooks"), icon: AppLogoIcon },
    { id: "help", label: t("nav.help"), icon: HelpCircle },
    { id: "more", label: IS_BUNDLE ? t("nav.import") : t("nav.moreApps"), icon: LayoutGrid },
    { id: "settings", label: t("nav.settings"), icon: SettingsIcon },
  ].filter(Boolean);
  return (
    <div className="border-t border-slate-200 bg-white flex">
      {items.map((it) => {
        const active = tab === it.id;
        return (
          <button key={it.id} onClick={() => setTab(it.id)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium ${active ? "text-teal-700" : "text-slate-400"}`}>
            <it.icon size={20} />
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Planned (things to buy / pay for) sidebar ----------
// A floating shortcut that's available on every screen — it never blocks the
// app underneath (it's a slide-over, not a full-screen modal) and isn't
// buried inside Settings.
function PlannedFAB({ pendingCount, onClick, hidden, t }) {
  return (
    <button
      onClick={onClick}
      className={`fixed right-4 bottom-36 z-30 w-14 h-14 rounded-full bg-teal-700 text-white shadow-lg shadow-teal-900/20 flex items-center justify-center active:scale-95 transition-opacity duration-150 ${hidden ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      title={t("planned.fabTitle")}
    >
      <ClipboardList size={20} />
      {pendingCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
          {pendingCount > 99 ? "99+" : pendingCount}
        </span>
      )}
    </button>
  );
}

function PlannedSidebar({ ctx, open, onClose }) {
  const { plannedItems, persistPlanned, appSettings, push, t } = ctx;
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(appSettings.categories[0] || "Other");
  const [editingId, setEditingId] = useState(null);

  const cancelEdit = () => { setEditingId(null); setDesc(""); setAmount(""); };

  const pending = plannedItems.filter((p) => !p.done);
  const done = plannedItems.filter((p) => p.done);
  const pendingTotal = pending.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const save = async () => {
    if (!desc.trim()) return;
    const amt = parseFloat(amount) || 0;
    if (editingId) {
      const next = plannedItems.map((p) => p.id === editingId ? { ...p, desc: desc.trim(), amount: amt, category } : p);
      await persistPlanned(next);
    } else {
      const item = { id: uid(), desc: desc.trim(), amount: amt, category, done: false, createdAt: new Date().toISOString(), reminderAt: null };
      await persistPlanned([item, ...plannedItems]);
    }
    cancelEdit();
  };

  const startEdit = (p) => { setEditingId(p.id); setDesc(p.desc); setAmount(p.amount ? String(p.amount) : ""); setCategory(p.category); };

  const toggleDone = async (p) => {
    const next = plannedItems.map((x) => x.id === p.id ? { ...x, done: !x.done } : x);
    await persistPlanned(next);
  };

  const remove = async (id) => {
    if (editingId === id) cancelEdit();
    const item = plannedItems.find((p) => p.id === id);
    if (item?.reminderAt) await cancelPlannedReminder(item);
    await persistPlanned(plannedItems.filter((p) => p.id !== id));
  };

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />}
      <div
        className={`fixed top-0 right-0 h-full w-[86%] max-w-sm bg-white z-50 shadow-2xl flex flex-col transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><ClipboardList size={18} /></div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-slate-900 truncate">{t("planned.title")}</div>
            <div className="text-xs text-slate-500 truncate">{t("planned.subtitle")}</div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 shrink-0"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
            {editingId && (
              <div className="flex items-center justify-between text-xs bg-teal-50 text-teal-700 rounded-lg px-2.5 py-1.5">
                {t("planned.editingItem")} <button onClick={cancelEdit} className="underline font-medium">{t("planned.cancel")}</button>
              </div>
            )}
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("planned.descPlaceholder")}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" />
            <div className="flex gap-2">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" placeholder={t("planned.amountPlaceholder")}
                className="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" />
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white">
                {appSettings.categories.map((c) => <option key={c} value={c}>{categoryLabel(t, c)}</option>)}
              </select>
            </div>
            <button onClick={save} className="w-full bg-teal-700 text-white py-2 rounded-lg text-sm font-medium">
              {editingId ? t("planned.updateItem") : t("planned.addToList")}
            </button>
          </div>

          <div className="flex items-center justify-between bg-teal-50 border border-teal-100 rounded-xl px-3 py-2.5">
            <span className="text-xs font-medium text-teal-800">{t("planned.pendingTotal", { count: pending.length })}</span>
            <span className="text-sm font-semibold text-teal-800">{appSettings.currency}{pendingTotal.toLocaleString()}</span>
          </div>

          {plannedItems.length === 0 ? (
            <EmptyState icon={ClipboardList} title={t("planned.emptyTitle")} hint={t("planned.emptyHint")} />
          ) : (
            <div className="divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl overflow-hidden">
              {[...pending, ...done].map((p) => (
                <div key={p.id} className={`flex items-center gap-2 px-3 py-2.5 ${p.done ? "opacity-50" : ""}`}>
                  <button onClick={() => toggleDone(p)} className="text-teal-700 shrink-0" title={p.done ? t("planned.markPending") : t("planned.markDone")}>
                    {p.done ? <CheckCircle2 size={18} /> : <Circle size={18} className="text-slate-300" />}
                  </button>
                  <button onClick={() => !p.done && startEdit(p)} className="flex-1 min-w-0 text-left">
                    <div className={`text-sm font-medium text-slate-900 truncate ${p.done ? "line-through" : ""}`}>{p.desc}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1 truncate">
                      <span>{categoryLabel(t, p.category)}</span>
                      {p.reminderAt && (
                        <span className="flex items-center gap-0.5 text-teal-700"><Bell size={10} /> {ctx.fmtDateTime(p.reminderAt)}</span>
                      )}
                    </div>
                  </button>
                  <span className="text-sm font-medium text-slate-700 shrink-0">{appSettings.currency}{Number(p.amount || 0).toLocaleString()}</span>
                  <button onClick={() => remove(p.id)} className="p-1 text-slate-300 hover:text-rose-600 shrink-0"><X size={14} /></button>
                </div>
              ))}
            </div>
          )}

          <button onClick={() => { onClose(); push("reminders"); }}
            className="w-full flex items-center justify-center gap-2 text-teal-700 border border-teal-200 rounded-xl py-2.5 text-sm font-medium">
            <Bell size={15} /> {t("planned.manageReminders")}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------- Reminder alarm popup ----------
// Shown when a scheduled reminder fires while the app is open, or when the
// user taps the notification (from the tray or a cold start). Plays the
// same alarm tone in-app (looped a few times) since a system notification
// only plays its sound once.
function ReminderAlarmModal({ alarm, onDismiss, onMarkDone, onSnooze, t }) {
  const audioRef = useRef(null);
  const stopTimerRef = useRef(null);

  useEffect(() => {
    if (!alarm) return;
    const audio = new Audio("/reminder-alarm.wav");
    audio.loop = true;
    audioRef.current = audio;
    audio.play().catch(() => {}); // browser may block autoplay without a prior gesture — fine, silent fallback
    stopTimerRef.current = setTimeout(() => { audio.pause(); }, 15000); // don't blare forever if left unattended
    return () => {
      clearTimeout(stopTimerRef.current);
      audio.pause();
      audioRef.current = null;
    };
  }, [alarm]);

  if (!alarm) return null;

  const stopSound = () => { audioRef.current?.pause(); clearTimeout(stopTimerRef.current); };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 text-center">
        <div className="w-14 h-14 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-3 animate-pulse">
          <BellRing size={26} />
        </div>
        <div className="text-xs font-medium text-rose-600 uppercase tracking-wide mb-1">{t("reminderAlarm.label")}</div>
        <div className="text-lg font-bold text-slate-900 mb-1">{alarm.desc}</div>
        <div className="text-sm text-slate-500 mb-5">
          {alarm.amount ? `${alarm.currency}${Number(alarm.amount).toLocaleString()} · ` : ""}{categoryLabel(t, alarm.category)}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button onClick={() => { stopSound(); onSnooze(); }} className="border border-slate-300 text-slate-700 rounded-xl py-2.5 text-sm font-medium">
            {t("reminderAlarm.snooze")}
          </button>
          <button onClick={() => { stopSound(); onMarkDone(); }} className="bg-emerald-700 text-white rounded-xl py-2.5 text-sm font-medium">
            {t("reminderAlarm.markDone")}
          </button>
        </div>
        <button onClick={() => { stopSound(); onDismiss(); }} className="w-full flex items-center justify-center gap-1.5 text-slate-500 text-sm py-2">
          <VolumeX size={14} /> {t("reminderAlarm.dismiss")}
        </button>
      </div>
    </div>
  );
}

// ---------- App ----------
export default function TallyBookApp() {
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState(null);
  const [unlocked, setUnlocked] = useState(false); // resets every cold start — that's what gives the "welcome back" login its purpose
  // Whether the user has actively confirmed which ledger they're working in
  // this session. Resets to false on every cold start (like `unlocked`), so a
  // returning user with more than one ledger lands on the ledger picker
  // instead of being silently dropped back into whichever one was active last
  // time. Ledgers load async, so this starts false and gets flipped true in
  // the initial-load effect once we know there's 0 or 1 ledger (nothing to
  // pick), or as soon as the user picks/creates one this session.
  const [sessionLedgerConfirmed, setSessionLedgerConfirmed] = useState(false);
  const [ledgers, setLedgers] = useState([]);
  const [session, setSession] = useState({ activeLedgerId: null, viewingAs: null });
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);
  const [theme, setTheme] = useState("light");
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  // Whether the one-time language + theme picker (shown before Welcome, only on
  // a device's very first launch) has already been completed. Starts null (not
  // yet known) rather than false, so the loading spinner stays up instead of the
  // picker flashing on for a returning user for one frame while storage loads.
  const [firstRunDone, setFirstRunDone] = useState(null);
  // Transient — only meaningful while firstRunDone is still false, and never
  // persisted, since it just sequences "picker" -> "about splash" within a
  // single first-launch session.
  const [showAboutSplash, setShowAboutSplash] = useState(false);
  const t = useMemo(() => getTranslator(language), [language]);
  // The Expenses Manager standalone build has no Home screen — it lands directly on
  // the ledger selector (the Cashbooks/"books" tab, which shows the Select Ledger
  // picker itself when there's more than one to choose from) right after Welcome /
  // Welcome back, instead of a Home hub it doesn't have any use for.
  const landingTab = APP_VARIANT === "expenses-manager" ? "books" : "home";
  const [tab, setTab] = useState(landingTab);
  const [stack, setStack] = useState([{ screen: landingTab }]);
  const [entriesCache, setEntriesCache] = useState({}); // bookId -> entries
  const [activityCache, setActivityCache] = useState({}); // bookId -> activity
  const [plannedItems, setPlannedItems] = useState([]); // things to buy / pay for (global, not tied to a book)
  const [plannedSidebarOpen, setPlannedSidebarOpen] = useState(false);
  const [notifPermission, setNotifPermission] = useState("unknown");
  const [inputFocused, setInputFocused] = useState(false); // hides the floating list button while typing so it can't sit on top of a Save button
  const [activeAlarm, setActiveAlarm] = useState(null); // reminder popup payload, shown on notification receipt/tap
  // Lets whichever screen is on top intercept the hardware back button first (to close
  // its own open modal/select-mode instead of leaving the screen). Set by screens via
  // ctx.setBackHandler; the handler returns true if it consumed the press.
  const backHandlerRef = useRef(null);

  const top = stack[stack.length - 1];
  const push = (screen, extra = {}) => setStack((s) => [...s, { screen, ...extra }]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const resetTo = (screen, extra = {}) => setStack([{ screen, ...extra }]);

  // ---- initial load ----
  useEffect(() => {
    (async () => {
      const acct = await onboardingGet("account", null);
      const biz = await storeGet("ledgers", []);
      const sess = await storeGet("session", { activeLedgerId: null, viewingAs: null });
      let settings = { ...DEFAULT_APP_SETTINGS, ...(await storeGet("app-settings", DEFAULT_APP_SETTINGS)) };
      // One-time migration: pull in any payment modes added to the defaults
      // after this install's app-settings was first saved (see
      // PAYMENT_MODES_MIGRATION_V2 above). Runs once per install — the
      // paymentModesV2 flag stops it from reintroducing a mode the user
      // later removes on purpose.
      if (!settings.paymentModesV2) {
        const missing = PAYMENT_MODES_MIGRATION_V2.filter((m) => !settings.paymentModes.includes(m));
        settings = { ...settings, paymentModes: [...settings.paymentModes, ...missing], paymentModesV2: true };
        await storeSet("app-settings", settings);
      }
      const savedTheme = await storeGet("app-theme", "light");
      setTheme(savedTheme);
      const savedLanguage = await storeGet("app-language", DEFAULT_LANGUAGE);
      setLanguage(savedLanguage);
      const savedFirstRunDone = await onboardingGet("first-run-done", false);
      setFirstRunDone(savedFirstRunDone);
      const planned = await storeGet("planned-items", []);
      setAccount(acct);
      setLedgers(biz);
      setAppSettings(settings);
      setPlannedItems(planned);
      const activeId = sess.activeLedgerId && biz.find(b => b.id === sess.activeLedgerId) ? sess.activeLedgerId : (biz[0]?.id || null);
      setSession({ ...sess, activeLedgerId: activeId });
      // 0 ledgers means there's nothing to pick yet (goes to the "create
      // your first ledger" screen instead). 1+ means it stays false, so the
      // Expenses Manager always lands on the Select Ledger screen first —
      // see the SwitchLedgerScreen render inside BooksScreen below.
      if (biz.length === 0) setSessionLedgerConfirmed(true);
      setLoading(false);
      checkNotifPermission().then(setNotifPermission);
      ensureReminderChannel();
      pushWidgetBalance(biz, settings);
    })();
  }, []);

  // ---- reminder notifications: pop up an alarm card whether the notification
  // fires while the app is open, or is tapped from the tray / a cold start ----
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const showAlarmFor = async (plannedItemId) => {
      if (!plannedItemId) return;
      // Re-read from storage rather than trusting React state — a tap from a
      // fully-closed app fires this before the rest of the app has loaded.
      const planned = await storeGet("planned-items", []);
      const settings = { ...DEFAULT_APP_SETTINGS, ...(await storeGet("app-settings", DEFAULT_APP_SETTINGS)) };
      const item = planned.find((p) => p.id === plannedItemId);
      if (!item) return;
      setActiveAlarm({ ...item, currency: settings.currency });
    };
    const receivedHandle = LocalNotifications.addListener("localNotificationReceived", (n) => {
      showAlarmFor(n?.extra?.plannedItemId);
    });
    const tappedHandle = LocalNotifications.addListener("localNotificationActionPerformed", (e) => {
      showAlarmFor(e?.notification?.extra?.plannedItemId);
    });
    return () => { receivedHandle.then((h) => h.remove()); tappedHandle.then((h) => h.remove()); };
  }, []);

  // ---- hide the floating "to buy/pay" button while a text field is focused,
  // so it can never sit on top of a Save/Add button pushed up by the keyboard ----
  useEffect(() => {
    const isFormEl = (el) => el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    const onFocusIn = (e) => { if (isFormEl(e.target)) setInputFocused(true); };
    const onFocusOut = (e) => { if (isFormEl(e.target)) setInputFocused(false); };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => { document.removeEventListener("focusin", onFocusIn); document.removeEventListener("focusout", onFocusOut); };
  }, []);

  const persistLedgers = useCallback(async (next) => {
    setLedgers(next);
    await storeSet("ledgers", next);
  }, []);
  const persistTheme = useCallback(async (next) => {
    setTheme(next);
    await storeSet("app-theme", next);
  }, []);
  const persistLanguage = useCallback(async (next) => {
    setLanguage(next);
    await storeSet("app-language", next);
  }, []);
  const completeFirstRun = useCallback(async () => {
    setFirstRunDone(true);
    await onboardingSet("first-run-done", true);
  }, []);
  // Mirror the theme onto <html> too, so backgrounds outside the app's root wrapper
  // (e.g. iOS overscroll/bounce edges) match instead of flashing white/black.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  // Arabic reads right-to-left — flip the document direction so text alignment,
  // icon placement, etc. follow suit. Every other supported language is LTR.
  useEffect(() => {
    document.documentElement.setAttribute("dir", language === "ar" ? "rtl" : "ltr");
  }, [language]);
  const persistSession = useCallback(async (next) => {
    setSession(next);
    await storeSet("session", next);
  }, []);
  const persistSettings = useCallback(async (next) => {
    setAppSettings(next);
    await storeSet("app-settings", next);
  }, []);
  const persistPlanned = useCallback(async (next) => {
    setPlannedItems(next);
    await storeSet("planned-items", next);
  }, []);
  const requestNotifPermission = useCallback(async () => {
    const p = await requestNotifPermissionNative();
    setNotifPermission(p);
    return p;
  }, []);

  const dismissAlarm = useCallback(() => setActiveAlarm(null), []);
  const markAlarmDone = useCallback(async () => {
    if (!activeAlarm) return;
    const planned = await storeGet("planned-items", []);
    const next = planned.map((p) => p.id === activeAlarm.id ? { ...p, done: true } : p);
    await persistPlanned(next);
    setActiveAlarm(null);
  }, [activeAlarm, persistPlanned]);
  const snoozeAlarm = useCallback(async () => {
    if (!activeAlarm) return;
    const planned = await storeGet("planned-items", []);
    const at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const item = planned.find((p) => p.id === activeAlarm.id);
    const next = planned.map((p) => p.id === activeAlarm.id ? { ...p, reminderAt: at } : p);
    await persistPlanned(next);
    if (item) await schedulePlannedReminder({ ...item, reminderAt: at });
    setActiveAlarm(null);
  }, [activeAlarm, persistPlanned]);

  // Hardware back button: close whatever's on top first (a screen's own overlay, then
  // the global planned-items sidebar / reminder popup), otherwise step back through the
  // in-app navigation stack one screen at a time, then fall back to this build's landing
  // tab (Home for most variants, Cashbooks for the Expenses Manager standalone build,
  // which has no Home screen — see landingTab above), and only exit the app once
  // there's truly nowhere left to go back to.
  useEffect(() => {
    let handle;
    CapacitorApp.addListener("backButton", () => {
      if (backHandlerRef.current && backHandlerRef.current()) return;
      if (plannedSidebarOpen) { setPlannedSidebarOpen(false); return; }
      if (activeAlarm) { dismissAlarm(); return; }
      if (stack.length > 1) { pop(); return; }
      if (tab !== landingTab) { setTab(landingTab); resetTo(landingTab); return; }
      CapacitorApp.exitApp();
    }).then((h) => { handle = h; });
    return () => { if (handle) handle.remove(); };
  }, [plannedSidebarOpen, activeAlarm, stack, tab, dismissAlarm, landingTab]);

  const activeLedger = ledgers.find((b) => b.id === session.activeLedgerId) || null;

  const getEntries = useCallback(async (bookId) => {
    if (entriesCache[bookId]) return entriesCache[bookId];
    const e = await storeGet(`entries:${bookId}`, []);
    setEntriesCache((c) => ({ ...c, [bookId]: e }));
    return e;
  }, [entriesCache]);

  const saveEntries = useCallback(async (bookId, next) => {
    setEntriesCache((c) => ({ ...c, [bookId]: next }));
    await storeSet(`entries:${bookId}`, next);
    pushWidgetBalance(ledgers, appSettings);
  }, [ledgers, appSettings]);

  // Stores a translation key + params rather than baked-in English text, so
  // activity entries render in whatever language is active *now* — including
  // entries logged in a different language than the one currently selected.
  // See ActivityScreen for the render side; activityMessageKeys lists every
  // key this can be called with.
  const logActivity = useCallback(async (bookId, key, params) => {
    const cur = activityCache[bookId] || (await storeGet(`activity:${bookId}`, []));
    const next = [{ id: uid(), key, params, at: new Date().toISOString() }, ...cur].slice(0, 50);
    setActivityCache((c) => ({ ...c, [bookId]: next }));
    await storeSet(`activity:${bookId}`, next);
    return next;
  }, [activityCache]);

  const getActivity = useCallback(async (bookId) => {
    if (activityCache[bookId]) return activityCache[bookId];
    const a = await storeGet(`activity:${bookId}`, []);
    setActivityCache((c) => ({ ...c, [bookId]: a }));
    return a;
  }, [activityCache]);

  // current viewer identity/role for the active ledger
  const viewer = useMemo(() => {
    if (!session.viewingAs) return { id: "you", name: "You", role: "Primary Admin" };
    const m = activeLedger?.members.find((mm) => mm.id === session.viewingAs);
    return m ? { id: m.id, name: m.name, role: m.role } : { id: "you", name: "You", role: "Primary Admin" };
  }, [session.viewingAs, activeLedger]);

  const canManage = viewer.role === "Primary Admin" || viewer.role === "Book Admin";
  const canAddEntries = canManage || viewer.role === "Data Operator";

  const createLedger = async (name) => {
    const nb = { id: uid(), name, createdAt: new Date().toISOString(), books: [], members: [], moveRequests: [] };
    const next = [...ledgers, nb];
    await persistLedgers(next);
    await persistSession({ ...session, activeLedgerId: nb.id });
    setSessionLedgerConfirmed(true); // creating one counts as picking it
    return nb;
  };
  const confirmLedgerSelection = useCallback(() => setSessionLedgerConfirmed(true), []);

  const createBook = async (name) => {
    if (!activeLedger) return;
    const nbBook = { id: uid(), name, createdAt: new Date().toISOString() };
    const next = ledgers.map((b) => b.id === activeLedger.id ? { ...b, books: [...b.books, nbBook] } : b);
    await persistLedgers(next);
    return nbBook;
  };

  if (loading) {
    return (
      <div data-theme={theme} className="w-full h-screen flex items-center justify-center bg-white">
        <Loader2 className="animate-spin text-teal-700" size={28} />
      </div>
    );
  }

  // Shown exactly once, the very first time the app is opened after install —
  // before the name/PIN Welcome screen, since language and theme are needed to
  // render Welcome itself sensibly. Skipped entirely for a returning user;
  // language/theme can still be changed later from Settings.
  if (!firstRunDone) {
    if (showAboutSplash) {
      return <AboutSplashScreen theme={theme} t={t} onDone={completeFirstRun} />;
    }
    return (
      <FirstRunScreen
        theme={theme} persistTheme={persistTheme}
        language={language} persistLanguage={persistLanguage}
        appSettings={appSettings} persistSettings={persistSettings}
        t={t}
        onDone={() => setShowAboutSplash(true)}
      />
    );
  }

  if (!account?.welcomed) {
    return (
      <WelcomeScreen
        theme={theme}
        persistTheme={persistTheme}
        t={t}
        onDone={async (acct) => {
          await onboardingSet("account", acct);
          setAccount(acct);
          setUnlocked(true);
        }}
      />
    );
  }

  if (!unlocked) {
    return (
      <WelcomeBackScreen
        theme={theme}
        persistTheme={persistTheme}
        t={t}
        account={account}
        onUnlock={() => setUnlocked(true)}
        onResetAccount={async () => {
          await onboardingSet("account", null);
          setAccount(null);
        }}
      />
    );
  }

  // Bundles the current language + calendar/time display preferences so date/time
  // helpers can be called as ctx.fmtDate(iso) etc. without every call site having
  // to assemble { language, calendarType, timeFormat } itself.
  const dtPref = { language, calendarType: appSettings.calendarType || "gregorian", timeFormat: appSettings.timeFormat || "12h" };
  const ctx = {
    ledgers, activeLedger, session, appSettings, viewer, canManage, canAddEntries,
    persistLedgers, persistSession, persistSettings,
    getEntries, saveEntries, getActivity, logActivity,
    createLedger, createBook,
    sessionLedgerConfirmed, confirmLedgerSelection,
    push, pop, resetTo, stack, top,
    plannedItems, persistPlanned, notifPermission, requestNotifPermission,
    theme, persistTheme,
    language, persistLanguage, t,
    dtPref,
    fmtDate: (iso) => fmtDate(iso, dtPref),
    fmtDateTime: (iso) => fmtDateTime(iso, dtPref),
    fmtTime: (time) => fmtTime(time, dtPref),
    setBackHandler: (fn) => { backHandlerRef.current = fn; },
  };

  const pendingPlannedCount = plannedItems.filter((p) => !p.done).length;

  return (
    <div data-theme={theme} className="w-full h-screen bg-slate-50 overflow-hidden flex flex-col relative">
      <div className="flex-1 overflow-hidden flex flex-col">
        <Router ctx={ctx} tab={tab} setTab={setTab} />
      </div>
      {/* Always visible, not just at the top of the stack — otherwise there was no way back to
          Home (or any other tab) from a nested screen short of tapping the header's back arrow
          all the way out one step at a time. Tapping a tab here always resets to that tab's
          top-level screen regardless of how deep the current stack is. */}
      <BottomNav tab={tab} setTab={(nextTab) => { setTab(nextTab); resetTo(nextTab); }} t={t} />
      <PlannedFAB pendingCount={pendingPlannedCount} onClick={() => setPlannedSidebarOpen(true)} hidden={inputFocused} t={t} />
      <PlannedSidebar ctx={ctx} open={plannedSidebarOpen} onClose={() => setPlannedSidebarOpen(false)} />
      <ReminderAlarmModal alarm={activeAlarm} onDismiss={dismissAlarm} onMarkDone={markAlarmDone} onSnooze={snoozeAlarm} t={t} />
    </div>
  );
}

// ---------- First run: language + theme picker ----------
// Shown once, for a few seconds, right after the language + theme picker —
// still part of the very-first-launch flow (see firstRunDone/showAboutSplash
// in App). Introduces what "Bejirond" means before the user gets into the
// app itself. Fades in, types the message out, holds, then advances — the
// Welcome screen right after this fades itself in, so the handoff between
// screens is a single consistent fade-in rather than a fade-out/fade-in pair.
// Auto-advances on a timer; deliberately has no button/skip since it's short
// by design and the point is just a brief, unhurried introduction, not a
// screen the user has to act on.
function AboutSplashScreen({ theme, t, onDone }) {
  const [visible, setVisible] = useState(false);
  const [typedLen, setTypedLen] = useState(0);
  const message = t("firstRun.aboutMessage");

  useEffect(() => {
    const fadeInTimer = setTimeout(() => setVisible(true), 30);
    const doneTimer = setTimeout(onDone, 9000);
    return () => { clearTimeout(fadeInTimer); clearTimeout(doneTimer); };
  }, [onDone]);

  useEffect(() => {
    if (typedLen >= message.length) return;
    const charDelay = Math.max(28, Math.min(60, 3800 / message.length));
    const timer = setTimeout(() => setTypedLen((n) => n + 1), charDelay);
    return () => clearTimeout(timer);
  }, [typedLen, message]);

  return (
    <div data-theme={theme} className="w-full h-screen bg-white overflow-hidden flex flex-col items-center justify-center px-8 text-center">
      <style>{`
        @keyframes bejirondDotBounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-7px); opacity: 1; } }
        @keyframes bejirondCursorBlink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
        @keyframes bejirondIconPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>
      <div style={{ opacity: visible ? 1 : 0, transition: "opacity 450ms ease" }} className="flex flex-col items-center">
        <AppLogoIcon size={80} className="mb-3" style={{ animation: "bejirondIconPulse 2.2s ease-in-out infinite" }} />
        <div className="flex items-center gap-1.5 mb-7">
          {[0, 1, 2].map((i) => (
            <span key={i} className="w-2 h-2 rounded-full bg-teal-700"
              style={{ animation: "bejirondDotBounce 1.1s ease-in-out infinite", animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        <p className="text-lg font-bold text-slate-800 leading-relaxed max-w-[300px]">
          {message.slice(0, typedLen)}
          <span className="inline-block w-[2px] h-[1.1em] bg-teal-700 ml-0.5 align-middle"
            style={{ animation: "bejirondCursorBlink 0.9s steps(1) infinite" }} />
        </p>
      </div>
    </div>
  );
}

// Shown once, before Welcome, only on a device's very first launch (see firstRunDone in
// App). Both choices can be changed later from Settings — this just sets a sensible
// starting point instead of forcing English/light on everyone by default.
function FirstRunScreen({ theme, persistTheme, language, persistLanguage, appSettings, persistSettings, t, onDone }) {
  // Each field starts as a preset default (language=en, theme=light, currency=Br) so the
  // underlying state is always valid — but we don't want that default to visually read as
  // "already chosen" or to let someone tap Continue without deliberately picking anything.
  // These flags track whether the user has actually tapped an option in each section;
  // Continue stays disabled, and no chip/button shows as active, until all three are touched.
  const [touched, setTouched] = useState({ language: false, theme: false, currency: false });
  const allTouched = touched.language && touched.theme && touched.currency;

  const chooseLanguage = (code) => { persistLanguage(code); setTouched((tt) => ({ ...tt, language: true })); };
  const chooseTheme = (val) => { persistTheme(val); setTouched((tt) => ({ ...tt, theme: true })); };
  const chooseCurrency = (c) => { persistSettings({ ...appSettings, currency: c }); setTouched((tt) => ({ ...tt, currency: true })); };

  return (
    <div data-theme={theme} className="w-full h-screen bg-white overflow-hidden flex flex-col">
      <div className="flex-1 overflow-y-auto flex flex-col items-center px-6 pt-14">
        <AppLogoIcon size={96} className="mb-6" />
        <h1 className="text-xl font-bold text-slate-900 text-center">{t("firstRun.title")}</h1>
        <p className="text-sm text-slate-500 text-center mt-1 mb-8 max-w-[280px]">{t("firstRun.subtitle")}</p>

        <div className="w-full mb-6">
          <div className="text-xs font-medium text-slate-400 uppercase mb-2 px-1">{t("firstRun.languageLabel")}</div>
          <div className="flex items-center gap-2 flex-wrap">
            {LANGUAGES.map((l) => (
              <Chip key={l.code} active={touched.language && language === l.code} onClick={() => chooseLanguage(l.code)}>
                {l.nativeName}
              </Chip>
            ))}
          </div>
        </div>

        <div className="w-full border-t border-slate-200 mb-6" />

        <div className="w-full mb-6">
          <div className="text-xs font-medium text-slate-400 uppercase mb-2 px-1">{t("firstRun.themeLabel")}</div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => chooseTheme("light")}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 ${touched.theme && theme === "light" ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`}>
              <Sun size={22} className="text-amber-500" />
              <span className="text-sm font-medium text-slate-800">{t("firstRun.themeLight")}</span>
            </button>
            <button onClick={() => chooseTheme("dark")}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 ${touched.theme && theme === "dark" ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`}>
              <Moon size={22} className="text-indigo-500" />
              <span className="text-sm font-medium text-slate-800">{t("firstRun.themeDark")}</span>
            </button>
          </div>
        </div>

        <div className="w-full border-t border-slate-200 mb-6" />

        <div className="w-full mb-6">
          <div className="text-xs font-medium text-slate-400 uppercase mb-2 px-1">{t("firstRun.currencyLabel")}</div>
          <div className="flex items-center gap-2 flex-wrap">
            {Object.keys(CURRENCIES).map((c) => (
              <Chip key={c} active={touched.currency && appSettings.currency === c} onClick={() => chooseCurrency(c)}>
                {c} {CURRENCIES[c]}
              </Chip>
            ))}
          </div>
        </div>

        <p className="text-xs text-slate-400 text-center mb-2">{t("firstRun.changeLaterNote")}</p>
      </div>
      <div className="p-4">
        <button onClick={onDone} disabled={!allTouched}
          className="w-full py-3 rounded-xl font-semibold transition-colors bg-teal-700 text-white disabled:opacity-40 disabled:cursor-not-allowed">
          {t("firstRun.continueButton")}
        </button>
      </div>
    </div>
  );
}

// ---------- Welcome / Welcome back ----------
// No backend here — this is a local-only name+PIN gate stored on-device (@capacitor/preferences),
// not real authentication. It's meant to keep the app from opening straight to someone else's data
// if they pick up the phone, not to protect against anything more serious than that.
function WelcomeScreen({ onDone, theme, persistTheme, t }) {
  const [mode, setMode] = useState(null); // null | "create"
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const fadeInTimer = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(fadeInTimer);
  }, []);

  const createAccount = () => {
    if (!name.trim()) { setError(t("welcome.errorNameRequired")); return; }
    if (!/^\d{4,6}$/.test(pin)) { setError(t("welcome.errorPinInvalid")); return; }
    if (pin !== pin2) { setError(t("welcome.errorPinMismatch")); return; }
    onDone({ welcomed: true, name: name.trim(), pin });
  };

  return (
    <div data-theme={theme} style={{ opacity: visible ? 1 : 0, transition: "opacity 450ms ease" }}
      className="relative w-full h-screen bg-white overflow-hidden flex flex-col">
      {persistTheme && (
        <button onClick={() => persistTheme(theme === "dark" ? "light" : "dark")}
          className="absolute top-4 right-4 z-10 shrink-0 w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 active:scale-95 transition-transform"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      )}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <AppLogoIcon size={96} className="mb-8" />
        <p className="text-sm text-slate-500 text-center mt-1 mb-8 max-w-[280px]">
          {mode === "create" ? t("welcome.subtitleCreate") : t("welcome.subtitleDefault")}
        </p>

        {mode === "create" ? (
          <div className="w-full space-y-3">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("welcome.namePlaceholder")}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm" />
            <input value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
              type="password" inputMode="numeric" placeholder={t("welcome.pinPlaceholder")}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm" />
            <input value={pin2} onChange={(e) => { setPin2(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
              type="password" inputMode="numeric" placeholder={t("welcome.pinConfirmPlaceholder")}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm" />
            {error && <div className="text-xs text-rose-600">{error}</div>}
            <button onClick={createAccount} className="w-full bg-teal-700 text-white py-3 rounded-xl font-semibold">{t("welcome.createAccountButton")}</button>
            <button onClick={() => { setMode(null); setError(""); }} className="w-full text-slate-500 text-sm py-2">{t("welcome.backButton")}</button>
          </div>
        ) : (
          <div className="w-full space-y-3">
            <button onClick={() => setMode("create")} className="w-full bg-teal-700 text-white py-3 rounded-xl font-semibold">{t("welcome.createAccountButton")}</button>
            <button onClick={() => onDone({ welcomed: true, name: "", pin: null })}
              className="w-full border border-slate-300 text-slate-700 py-3 rounded-xl font-semibold">{t("welcome.useWithoutAccountButton")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function WelcomeBackScreen({ account, onUnlock, onResetAccount, theme, persistTheme, t }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!account?.pin) onUnlock(); // no PIN was set — nothing to check, go straight in
  }, [account?.pin]);

  if (!account?.pin) return null; // brief flash before the effect above fires

  const tryUnlock = () => {
    if (pin === account.pin) onUnlock();
    else setError(t("welcomeBack.errorIncorrectPin"));
  };

  return (
    <div data-theme={theme} className="relative w-full h-screen bg-white overflow-hidden flex flex-col">
      {persistTheme && (
        <button onClick={() => persistTheme(theme === "dark" ? "light" : "dark")}
          className="absolute top-4 right-4 z-10 shrink-0 w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 active:scale-95 transition-transform"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      )}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-20 h-20 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center mb-8">
          <AppLogoIcon size={36} />
        </div>
        <h1 className="text-xl font-bold text-slate-900 text-center">
          {account.name ? t("welcomeBack.titleWithName", { name: account.name }) : t("welcomeBack.title")}
        </h1>
        <p className="text-sm text-slate-500 text-center mt-1 mb-8">{t("welcomeBack.subtitle")}</p>
        <div className="w-full space-y-3">
          <input autoFocus value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }}
            type="password" inputMode="numeric" placeholder={t("welcomeBack.pinPlaceholder")}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-center tracking-[0.3em]" />
          {error && <div className="text-xs text-rose-600 text-center">{error}</div>}
          <button onClick={tryUnlock} className="w-full bg-teal-700 text-white py-3 rounded-xl font-semibold">{t("welcomeBack.loginButton")}</button>
          <button onClick={onResetAccount} className="w-full text-slate-400 text-xs py-2">{t("welcomeBack.forgotPin")}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Choose ledger type (moved out of first launch — now shown inside Expenses
// Manager the first time a ledger needs to be created, since it's specific to that tool) ----------
function ChooseLedgerType({ onDone, t }) {
  const [choice, setChoice] = useState(null);
  const options = [
    { id: "ledger", label: t("chooseLedgerType.ledger"), icon: Building2 },
    { id: "personal", label: t("chooseLedgerType.personal"), icon: Wallet },
    { id: "explore", label: t("chooseLedgerType.explore"), icon: Info },
  ];
  return (
    <div className="w-full h-full bg-white overflow-hidden flex flex-col">
      <div className="flex-1 flex flex-col items-center px-6 pt-10">
        <AppLogoIcon size={96} className="mb-8" />
        <h1 className="text-xl font-bold text-slate-900 text-center">{t("chooseLedgerType.title")}</h1>
        <p className="text-xs text-slate-400 text-center mt-1 mb-8">{t("chooseLedgerType.note")}</p>
        <div className="w-full border border-slate-200 rounded-xl divide-y divide-slate-200">
          {options.map((o) => (
            <button key={o.id} onClick={() => setChoice(o.id)} className="w-full flex items-center gap-3 px-4 py-4">
              <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700"><o.icon size={18} /></div>
              <div className="flex-1 text-left font-medium text-slate-800">{o.label}</div>
              <div className={`w-5 h-5 rounded-full border-2 ${choice === o.id ? "border-teal-700 bg-teal-700" : "border-slate-300"} flex items-center justify-center`}>
                {choice === o.id && <Check size={12} className="text-white" />}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        <button disabled={!choice} onClick={() => onDone(choice)}
          className={`w-full flex items-center justify-center gap-1 py-3 rounded-xl font-semibold ${choice ? "bg-teal-700 text-white" : "bg-slate-200 text-slate-400"}`}>
          {t("chooseLedgerType.next")} <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ---------- More Apps / data portability ----------
// What this screen shows depends on APP_VARIANT (src/appConfig.js):
//  - On the bundle build: an "Import data" section, for someone who used
//    one of the standalone single-tool apps first and now wants that data
//    inside the full bundle.
//  - On a single-tool build: cross-promotion — the other standalone
//    በጅሮንድ apps, plus an upsell card for the full ad-free bundle.
// Android sandboxes each app's storage, so this is file-based (export to a
// shared file, import that file elsewhere) rather than automatic detection.
function ImportRow({ product, onDone, t }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const inputRef = useRef(null);
  const scope = PRODUCT_DATA_SCOPES[product.id];
  const hasScope = scope && (scope.exactKeys.length || scope.prefixes.length);
  const productName = t(`moreApps.products.${product.id}.name`);

  const onFile = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const exportBundle = await readExportFile(file);
      if (exportBundle.product !== product.id) {
        setMsg({ ok: false, text: t("moreApps.wrongFileError", { product: t(`moreApps.products.${exportBundle.product}.name`), name: productName }) });
        return;
      }
      const already = await hasExistingData(product.id);
      if (already && !confirm(t("moreApps.replaceConfirm", { name: productName }))) {
        return;
      }
      const result = await importProductData(exportBundle);
      setMsg({ ok: true, text: t("moreApps.importedData", { name: productName }) });
      onDone && onDone(result);
    } catch (err) {
      setMsg({ ok: false, text: err.message || t("moreApps.importFailed") });
    } finally {
      setBusy(false);
    }
  }, [product, onDone, t, productName]);

  if (!hasScope) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Upload size={18} /></div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-900 text-sm">{productName}</div>
          <div className="text-xs text-slate-500">{t(`moreApps.products.${product.id}.tagline`)}</div>
        </div>
        <button onClick={() => inputRef.current && inputRef.current.click()} disabled={busy}
          className="shrink-0 text-xs font-medium bg-teal-700 text-white rounded-lg px-3 py-2 disabled:opacity-50">
          {busy ? t("moreApps.importingButton") : t("moreApps.importFileButton")}
        </button>
        <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
      </div>
      {msg && <div className={`text-xs mt-2 ${msg.ok ? "text-teal-700" : "text-rose-600"}`}>{msg.text}</div>}
    </div>
  );
}

function ProductRow({ product, isBundleCard, t }) {
  return (
    <div className={`w-full flex items-center gap-3 border rounded-xl p-4 ${isBundleCard ? "bg-teal-700 border-teal-700" : "bg-white border-slate-200"}`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isBundleCard ? "bg-teal-600 text-white" : "bg-slate-50 text-slate-700"}`}>
        {isBundleCard ? <Sparkles size={18} /> : <LayoutGrid size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`font-medium text-sm ${isBundleCard ? "text-white" : "text-slate-900"}`}>{t(`moreApps.products.${product.id}.name`)}</div>
        <div className={`text-xs ${isBundleCard ? "text-teal-100" : "text-slate-500"}`}>{t(`moreApps.products.${product.id}.tagline`)}</div>
      </div>
      {product.playStoreUrl ? (
        <a href={product.playStoreUrl} target="_blank" rel="noopener noreferrer"
          className={`shrink-0 text-xs font-medium rounded-lg px-3 py-2 ${isBundleCard ? "bg-white text-teal-700" : "bg-slate-800 text-white"}`}>
          {t("moreApps.getButton")}
        </a>
      ) : (
        // No playStoreUrl yet (see NOTES.md — package IDs not set up yet), so this
        // doesn't link anywhere yet, but stays styled like an active "Get" button
        // rather than a grayed-out "Coming soon" pill.
        <button type="button"
          className={`shrink-0 text-xs font-medium rounded-lg px-3 py-2 ${isBundleCard ? "bg-white text-teal-700" : "bg-slate-800 text-white"}`}>
          {t("moreApps.getButton")}
        </button>
      )}
    </div>
  );
}

function MoreAppsScreen({ ctx }) {
  const { pop, t } = ctx;
  const [importedTick, setImportedTick] = useState(0);

  if (IS_BUNDLE) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <TopHeader ctx={ctx} title={t("moreApps.importTitle")} subtitle={t("moreApps.importSubtitle")} onBack={pop} />
        <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-28">
          <div className="text-xs text-slate-500 px-1">
            {t("moreApps.importHint")}
          </div>
          {PRODUCTS.map((p) => <ImportRow key={p.id} product={p} onDone={() => setImportedTick((n) => n + 1)} t={t} />)}
        </div>
      </div>
    );
  }

  const self = productById(APP_VARIANT);
  const others = PRODUCTS.filter((p) => p.id !== APP_VARIANT);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("moreApps.title")} subtitle={t("moreApps.subtitle")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-28">
        <ProductRow product={BUNDLE_PRODUCT} isBundleCard t={t} />
        <div className="text-xs font-medium text-slate-400 uppercase px-1 pt-2">{t("moreApps.alsoAvailable")}</div>
        {others.map((p) => <ProductRow key={p.id} product={p} t={t} />)}
        {/* Not linked yet — waiting on the TeredaTrades URL/Telegram channel to point this at.
            Also shown here (not just Home) since the Expenses Manager standalone build has no
            Home screen, so this is its only route to it. */}
        <button className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-4 text-left">
          <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><TrendingUp size={18} /></div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-slate-900 text-sm">{t("moreApps.tradingCta")}</div>
          </div>
        </button>
        {self && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 mt-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Download size={18} /></div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 text-sm">{t("moreApps.exportDataTitle", { name: t(`moreApps.products.${self.id}.name`) })}</div>
                <div className="text-xs text-slate-500">{t("moreApps.exportDataHint")}</div>
              </div>
              <button onClick={() => exportProductData(APP_VARIANT).catch((e) => alert(e.message))}
                className="shrink-0 text-xs font-medium bg-teal-700 text-white rounded-lg px-3 py-2">
                {t("moreApps.exportButton")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Router ----------
function Router({ ctx, tab, setTab }) {
  const { top } = ctx;
  switch (top.screen) {
    case "more": return <MoreAppsScreen ctx={ctx} />;
    case "books": return <BooksScreen ctx={ctx} />;
    case "help": return <HelpScreen ctx={ctx} />;
    case "settings": return <SettingsScreen ctx={ctx} />;
    case "book": return <BookScreen ctx={ctx} bookId={top.bookId} />;
    case "addEntry": return <AddEntryScreen ctx={ctx} bookId={top.bookId} type={top.type} editEntry={top.editEntry} />;
    case "entryDetail": return <EntryDetailScreen ctx={ctx} bookId={top.bookId} entryId={top.entryId} />;
    case "bookSettings": return <BookSettingsScreen ctx={ctx} bookId={top.bookId} />;
    case "addMember": return <AddMemberScreen ctx={ctx} bookId={top.bookId} />;
    case "reports": return <ReportsScreen ctx={ctx} bookId={top.bookId} />;
    case "charts": return <ChartsScreen ctx={ctx} bookId={top.bookId} />;
    case "reportView": return <ReportViewScreen ctx={ctx} bookId={top.bookId} filters={top.filters} />;
    case "ledgerTeam": return <LedgerTeamScreen ctx={ctx} />;
    case "moveRequests": return <MoveRequestsScreen ctx={ctx} />;
    case "ledgerSettings": return <LedgerSettingsScreen ctx={ctx} />;
    case "appSettings": return <AppSettingsScreen ctx={ctx} />
    case "reminders": return <RemindersScreen ctx={ctx} />;
    case "theme": return <ThemeScreen ctx={ctx} />;
    case "language": return <LanguageScreen ctx={ctx} />;
    case "suggestTranslation": return <SuggestTranslationScreen ctx={ctx} />;
    case "quickAccess": return <QuickAccessScreen ctx={ctx} />;
    case "profile": return <ProfileScreen ctx={ctx} />;
    case "backup": return <BackupRestoreScreen ctx={ctx} />;
    case "about": return <AboutScreen ctx={ctx} />;
    case "switchLedger": return <SwitchLedgerScreen ctx={ctx} />;
    case "activity": return <ActivityScreen ctx={ctx} bookId={top.bookId} />;
    default: return <BooksScreen ctx={ctx} />;
  }
}

// ---------- Books list ----------
function BooksScreen({ ctx }) {
  const { activeLedger, push, canManage, getEntries, appSettings, ledgers, persistLedgers, createLedger, sessionLedgerConfirmed, confirmLedgerSelection, theme, persistTheme, t } = ctx;
  const [showTemplates, setShowTemplates] = useState(false);
  const [newName, setNewName] = useState("");
  const [balances, setBalances] = useState({});

  const addBook = async (name) => {
    if (!name.trim()) return;
    const b = await ctx.createBook(name.trim());
    setNewName(""); setShowTemplates(false);
    push("book", { bookId: b.id });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeLedger) return;
      const entries = {};
      for (const bk of activeLedger.books) {
        const es = await getEntries(bk.id);
        entries[bk.id] = es.reduce((s, e) => s + (e.type === "in" ? e.amount : -e.amount), 0);
      }
      if (!cancelled) setBalances(entries);
    })();
    return () => { cancelled = true; };
  }, [activeLedger?.id, activeLedger?.books.length]);

  const toggleHidden = async (bookId) => {
    const next = ledgers.map((b) => b.id === activeLedger.id
      ? { ...b, books: b.books.map((bk) => bk.id === bookId ? { ...bk, hidden: !bk.hidden } : bk) }
      : b);
    await persistLedgers(next);
  };

  // First time in the Expenses Manager (no ledger created yet) — this is where the
  // "what will you manage?" question belongs, not on the app's very first screen.
  if (ledgers.length === 0) {
    return (
      <ChooseLedgerType t={ctx.t} onDone={async () => {
        await createLedger(ctx.t("books.defaultLedgerName"));
      }} />
    );
  }

  // Returning user who hasn't confirmed a ledger yet this session (e.g. just
  // unlocked the app) — show the picker instead of silently continuing in
  // whichever ledger happened to be active last time. Shown even with just
  // one ledger, so Expenses Manager always opens on Select Ledger first.
  if (ledgers.length >= 1 && !sessionLedgerConfirmed) {
    return <SwitchLedgerScreen ctx={ctx} embedded onDone={confirmLedgerSelection} />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-200 bg-white">
        <button onClick={() => push("switchLedger")} className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Building2 size={18} /></div>
          <div className="text-left min-w-0">
            <div className="font-semibold text-slate-900 truncate max-w-[180px]">{activeLedger?.name || t("books.selectLedger")}</div>
            {activeLedger?.name === t("books.defaultLedgerName") && (
              <div className="text-[11px] text-slate-400">{t("books.renameHint")}</div>
            )}
          </div>
          <ChevronDown size={16} className="text-slate-400 shrink-0" />
        </button>
        <button onClick={() => push("ledgerTeam")} className="p-2 text-teal-700"><UserPlus size={20} /></button>
        <button onClick={() => persistTheme(theme === "dark" ? "light" : "dark")}
          className="shrink-0 w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 active:scale-95 transition-transform"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-28 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-500">{t("books.yourBooks")}</span>
          <Search size={18} className="text-slate-400" />
        </div>

        {(!activeLedger || activeLedger.books.length === 0) && (
          <EmptyState icon={AppLogoIcon} title={t("books.noBooksTitle")} hint={t("books.noBooksHint")} />
        )}

        <div className="divide-y divide-slate-200 bg-white rounded-xl border border-slate-200">
          {activeLedger?.books.map((bk) => {
            const net = balances[bk.id] || 0;
            const c = bookCurrency(bk, appSettings);
            return (
              <div key={bk.id} className="w-full flex items-center gap-3 px-4 py-3.5">
                <button onClick={() => push("book", { bookId: bk.id })} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                  <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><AppLogoIcon size={26} className="rounded-md" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 truncate">{bk.name}</div>
                    <div className="text-xs text-slate-500">{t("books.created", { date: ctx.fmtDate(bk.createdAt.slice(0,10)) })}</div>
                  </div>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  {!bk.hidden && (
                    <span className={`text-sm font-semibold ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {net < 0 ? "-" : ""}{c}{Math.abs(net).toLocaleString()}
                    </span>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); toggleHidden(bk.id); }} className="p-1.5 text-slate-400 hover:text-slate-600" title={bk.hidden ? t("books.showBalance") : t("books.hideBalance")}>
                    {bk.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {canManage && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="font-medium text-slate-800 mb-1">{t("books.addNewBookTitle")}</div>
            <div className="text-xs text-slate-500 mb-3">{t("books.addNewBookHint")}</div>
            <div className="flex flex-wrap gap-2 mb-3">
              {BOOK_TEMPLATE_KEYS.map((key) => (
                <Chip key={key} onClick={() => addBook(t(`books.template${key[0].toUpperCase()}${key.slice(1)}`))}>
                  {t(`books.template${key[0].toUpperCase()}${key.slice(1)}`)}
                </Chip>
              ))}
            </div>
            {showTemplates ? (
              <div className="flex gap-2">
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("books.bookNamePlaceholder")}
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                <button onClick={() => addBook(newName)} className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">{t("common.add")}</button>
              </div>
            ) : (
              <button onClick={() => setShowTemplates(true)} className="w-full flex items-center justify-center gap-1 bg-teal-700 text-white py-2.5 rounded-xl font-medium">
                <Plus size={18} /> {t("books.addNewBookButton")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// `embedded` + `onDone` let this screen double as the Cashbooks/Expenses
// Manager landing screen itself (rather than only a modal pushed on top of
// it) — used by BooksScreen to force a fresh pick each login when there's
// more than one ledger. In that mode there's no screen underneath to
// `pop()` back to, so selecting/creating a ledger (or dismissing) calls
// `onDone` instead, which just marks the session as confirmed.
function SwitchLedgerScreen({ ctx, embedded, onDone }) {
  const { ledgers, session, persistSession, pop, createLedger, t } = ctx;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const finish = () => { if (embedded) onDone?.(); else pop(); };
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("switchLedger.title")} right={<button onClick={finish}><X size={20} className="text-slate-500" /></button>} />
      <div className="p-4 space-y-2 flex-1 overflow-y-auto">
        {embedded && (
          <p className="text-xs text-slate-500 mb-1">
            {ledgers.length > 1 ? t("switchLedger.hintMultiple") : t("switchLedger.hintSingle")}
          </p>
        )}
        <div className="text-xs font-medium text-slate-400 uppercase mb-1">{t("switchLedger.yourLedgers")}</div>
        {ledgers.map((b) => (
          <button key={b.id} onClick={async () => { await persistSession({ ...session, activeLedgerId: b.id, viewingAs: null }); finish(); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border ${session.activeLedgerId === b.id ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-white"}`}>
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700"><Building2 size={16} /></div>
            <div className="flex-1 text-left">
              <div className="font-medium text-slate-900">{b.name}</div>
              <div className="text-xs text-slate-500">
                {b.books.length === 1 ? t("switchLedger.bookCountOne", { count: b.books.length }) : t("switchLedger.bookCountOther", { count: b.books.length })}
              </div>
            </div>
            {session.activeLedgerId === b.id && <Check size={18} className="text-teal-700" />}
          </button>
        ))}
        {creating ? (
          <div className="flex gap-2 pt-2">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("switchLedger.ledgerNamePlaceholder")}
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={async () => { if (name.trim()) { await createLedger(name.trim()); finish(); } }}
              className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">{t("common.add")}</button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} className="w-full flex items-center justify-center gap-1 bg-teal-700 text-white py-3 rounded-xl font-semibold mt-2">
            <Plus size={18} /> {t("switchLedger.addNewLedger")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Book screen ----------
// ---------- This-month collapsible summary (per book) ----------
// Collapsed by default: just the net for the current month, so it doesn't
// compete for space with the entry list. Expands to income/expense totals
// and the top 3 expense categories with slim progress bars. Nothing is
// shown at all if there's no activity yet this month (e.g. a brand-new
// book) — an empty summary isn't useful and just adds clutter.
function MonthSummaryCard({ entries, cur, t }) {
  const [expanded, setExpanded] = useState(false);
  const monthKey = todayStr().slice(0, 7); // "YYYY-MM"
  const monthEntries = (entries || []).filter((e) => (e.date || "").slice(0, 7) === monthKey);

  if (monthEntries.length === 0) return null;

  const totalIn = monthEntries.filter((e) => e.type === "in").reduce((s, e) => s + e.amount, 0);
  const totalOut = monthEntries.filter((e) => e.type === "out").reduce((s, e) => s + e.amount, 0);
  const net = totalIn - totalOut;

  const byCategory = {};
  monthEntries.filter((e) => e.type === "out").forEach((e) => {
    const key = e.category || "__uncategorized__";
    byCategory[key] = (byCategory[key] || 0) + e.amount;
  });
  const topCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const maxCategoryAmount = topCategories.length ? topCategories[0][1] : 0;

  return (
    <div className="bg-white border-b border-slate-200">
      <button onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">{t("monthSummary.title")}</span>
          <span className={`font-semibold text-sm ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {net >= 0 ? "+" : "-"}{cur}{Math.abs(net).toLocaleString()}
          </span>
        </div>
        <ChevronDown size={18} className={`text-slate-400 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 rounded-lg p-2.5">
              <div className="text-xs text-emerald-700">{t("entries.totalIn")}</div>
              <div className="font-semibold text-emerald-800">{cur}{totalIn.toLocaleString()}</div>
            </div>
            <div className="bg-rose-50 rounded-lg p-2.5">
              <div className="text-xs text-rose-700">{t("entries.totalOut")}</div>
              <div className="font-semibold text-rose-800">{cur}{totalOut.toLocaleString()}</div>
            </div>
          </div>
          {topCategories.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-500">{t("monthSummary.topCategories")}</div>
              {topCategories.map(([cat, amt]) => (
                <div key={cat}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-600">{cat === "__uncategorized__" ? t("reportView.uncategorized") : categoryLabel(t, cat)}</span>
                    <span className="text-slate-500">{cur}{amt.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-teal-600 rounded-full" style={{ width: `${maxCategoryAmount ? (amt / maxCategoryAmount) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BookScreen({ ctx, bookId }) {
  const { activeLedger, ledgers, push, pop, getEntries, saveEntries, appSettings, canAddEntries, viewer, logActivity, setBackHandler, t } = ctx;
  const book = activeLedger?.books.find((b) => b.id === bookId);
  const [entries, setEntries] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [moveCopyEntries, setMoveCopyEntries] = useState(null); // array of entries, or null
  const [deleteConfirmEntries, setDeleteConfirmEntries] = useState(null); // array of entries, or null
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  useEffect(() => { getEntries(bookId).then(setEntries); }, [bookId]);

  // Let the hardware back button close whichever overlay is open (confirm prompt,
  // move/copy sheet, select mode) one step at a time instead of leaving the screen.
  useEffect(() => {
    setBackHandler?.(() => {
      if (deleteConfirmEntries) { setDeleteConfirmEntries(null); return true; }
      if (moveCopyEntries) { setMoveCopyEntries(null); return true; }
      if (selectMode) { setSelectMode(false); setSelectedIds(new Set()); return true; }
      return false;
    });
    return () => setBackHandler?.(null);
  }, [deleteConfirmEntries, moveCopyEntries, selectMode, setBackHandler]);

  if (!book) return <EmptyState icon={AppLogoIcon} title={t("bookScreen.bookNotFound")} />;

  // Move/copy targets span every ledger the user has, not just the active one —
  // each book is tagged with which ledger it belongs to so the picker can group
  // them and doMoveOrCopy can find it regardless of which ledger is "active".
  const otherBooks = (ledgers || [])
    .flatMap((biz) => biz.books.map((b) => ({ ...b, ledgerId: biz.id, ledgerName: biz.name })))
    .filter((b) => b.id !== bookId);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const enterSelectMode = (firstId) => {
    setSelectMode(true);
    setSelectedIds(firstId ? new Set([firstId]) : new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const doMoveOrCopy = async (targetBookId, mode) => {
    const selected = moveCopyEntries;
    if (!selected || selected.length === 0) return;
    const selectedIdSet = new Set(selected.map((e) => e.id));
    const targetBook = otherBooks.find((b) => b.id === targetBookId);
    // Include the source ledger name in the stamp when the move/copy crosses into a
    // different ledger, so the entry's transfer history stays legible from either side.
    const crossLedger = targetBook && targetBook.ledgerId !== activeLedger?.id;
    const stamp = {
      transferredFrom: crossLedger ? `${book?.name} (${activeLedger?.name})` : book?.name,
      transferredAt: new Date().toISOString(),
    };
    const sourceEntries = await getEntries(bookId);
    const targetEntries = await getEntries(targetBookId);
    const count = selected.length;
    const suffix = count === 1 ? "One" : "Other";
    if (mode === "move") {
      const nextSource = sourceEntries.filter((e) => !selectedIdSet.has(e.id));
      const moved = sourceEntries.filter((e) => selectedIdSet.has(e.id)).map((e) => ({ ...e, ...stamp }));
      await saveEntries(bookId, nextSource);
      await saveEntries(targetBookId, [...targetEntries, ...moved]);
      await logActivity(bookId, `activity.movedOut${suffix}`, { name: viewer.name, count, book: targetBook?.name });
      await logActivity(targetBookId, `activity.movedIn${suffix}`, { name: viewer.name, count, book: book?.name });
      setEntries(nextSource);
    } else {
      const copied = sourceEntries.filter((e) => selectedIdSet.has(e.id)).map((e) => ({ ...e, ...stamp, id: uid() }));
      await saveEntries(targetBookId, [...targetEntries, ...copied]);
      await logActivity(bookId, `activity.copiedOut${suffix}`, { name: viewer.name, count, book: targetBook?.name });
      await logActivity(targetBookId, `activity.copiedIn${suffix}`, { name: viewer.name, count, book: book?.name });
    }
    setMoveCopyEntries(null);
    exitSelectMode();
  };

  const doDeleteSelected = async () => {
    const selected = deleteConfirmEntries;
    if (!selected || selected.length === 0) return;
    const selectedIdSet = new Set(selected.map((e) => e.id));
    const es = await getEntries(bookId);
    const next = es.filter((e) => !selectedIdSet.has(e.id));
    await saveEntries(bookId, next);
    await logActivity(bookId, selected.length === 1 ? "activity.deletedEntriesOne" : "activity.deletedEntriesOther", { name: viewer.name, count: selected.length });
    setEntries(next);
    setDeleteConfirmEntries(null);
    exitSelectMode();
  };

  const cur = bookCurrency(book, appSettings);
  const totalIn = (entries || []).filter(e => e.type === "in").reduce((s, e) => s + e.amount, 0);
  const totalOut = (entries || []).filter(e => e.type === "out").reduce((s, e) => s + e.amount, 0);
  const net = totalIn - totalOut;

  // running balance as of each entry, in true chronological (transaction) order
  const chronological = [...(entries || [])].sort((a, b) => entryDateTime(a) - entryDateTime(b) || (a.createdAt || "").localeCompare(b.createdAt || ""));
  const balanceAfter = {};
  let running = 0;
  chronological.forEach((e) => { running += e.type === "in" ? e.amount : -e.amount; balanceAfter[e.id] = running; });

  const visible = chronological
    .filter((e) => {
      if (typeFilter === "in" && e.type !== "in") return false;
      if (typeFilter === "out" && e.type !== "out") return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (![e.contact, e.remark, e.category].some((v) => (v || "").toLowerCase().includes(q))) return false;
      }
      return true;
    })
    .slice()
    .reverse(); // newest first for display

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx}
        title={book.name}
        subtitle={ctx.t("entries.subtitle")}
        onBack={selectMode ? exitSelectMode : pop}
        right={
          selectMode ? (
            <button onClick={exitSelectMode} className="text-sm font-medium text-teal-700 px-2">{ctx.t("common.cancel")}</button>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={() => enterSelectMode()} className="p-2 text-teal-700"><CheckSquare size={18} /></button>
              <button onClick={() => push("charts", { bookId })} className="p-2 text-teal-700"><PieChartIcon size={18} /></button>
              <button onClick={() => push("addMember", { bookId })} className="p-2 text-teal-700"><UserPlus size={18} /></button>
              <button onClick={() => push("reports", { bookId })} className="p-2 text-teal-700"><FileText size={18} /></button>
              <button onClick={() => push("bookSettings", { bookId })} className="p-2 text-slate-500"><MoreVertical size={18} /></button>
            </div>
          )
        }
      />

      {selectMode && (
        <div className="bg-teal-50 border-b border-teal-100 px-4 py-2.5 flex items-center justify-between">
          <button onClick={() => {
            const allSelected = visible.length > 0 && visible.every((e) => selectedIds.has(e.id));
            setSelectedIds(allSelected ? new Set() : new Set(visible.map((e) => e.id)));
          }} className="flex items-center gap-2 text-sm font-medium text-teal-700">
            {visible.length > 0 && visible.every((e) => selectedIds.has(e.id))
              ? <CheckCircle2 size={18} /> : <Circle size={18} />}
            {ctx.t("entries.selectAll")}
          </button>
          <span className="text-sm text-slate-600">{ctx.t("entries.selectedCount", { count: selectedIds.size })}</span>
        </div>
      )}

      <div className="bg-white border-b border-slate-200 px-4 py-3 space-y-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={ctx.t("entries.searchPlaceholder")}
            className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm" />
        </div>
        <div className="flex gap-2">
          {[["all", ctx.t("entries.all")], ["in", ctx.t("entries.cashIn")], ["out", ctx.t("entries.cashOut")]].map(([key, label]) => (
            <Chip key={key} active={typeFilter === key} onClick={() => setTypeFilter(key)}>{label}</Chip>
          ))}
        </div>
      </div>

      <div className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">{ctx.t("entries.netBalance")}</span>
          <span className={`font-bold text-lg ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{cur}{Math.abs(net).toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm text-slate-500">{ctx.t("entries.totalIn")}</span>
          <span className="text-emerald-700 font-medium">{cur}{totalIn.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm text-slate-500">{ctx.t("entries.totalOut")}</span>
          <span className="text-rose-700 font-medium">{cur}{totalOut.toLocaleString()}</span>
        </div>
      </div>

      <MonthSummaryCard entries={entries} cur={cur} t={ctx.t} />

      <div className="flex-1 overflow-y-auto">
        {entries === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-700" size={24} /></div>
        ) : entries.length === 0 ? (
          <EmptyState icon={Wallet} title={ctx.t("entries.noEntriesTitle")} hint={ctx.t("entries.noEntriesHint")} />
        ) : visible.length === 0 ? (
          <EmptyState icon={Search} title={ctx.t("entries.noMatchTitle")} hint={ctx.t("entries.noMatchHint")} />
        ) : (
          <div className="divide-y divide-slate-100">
            {visible.map((e) => (
              <EntryRow key={e.id} e={e} cur={cur} balanceText={balanceAfter[e.id].toLocaleString()} t={ctx.t} fmtDate={ctx.fmtDate} fmtTime={ctx.fmtTime}
                selectMode={selectMode}
                selected={selectedIds.has(e.id)}
                onTap={() => selectMode ? toggleSelect(e.id) : push("entryDetail", { bookId, entryId: e.id })}
                onLongPress={() => selectMode ? toggleSelect(e.id) : enterSelectMode(e.id)} />
            ))}
          </div>
        )}
      </div>

      {selectMode ? (
        <div className="p-3 border-t border-slate-200 bg-white flex gap-2">
          <button onClick={exitSelectMode}
            className="px-4 py-2.5 rounded-xl font-semibold border border-slate-300 text-slate-600">
            {ctx.t("common.cancel")}
          </button>
          <button
            disabled={selectedIds.size === 0}
            onClick={() => setDeleteConfirmEntries((entries || []).filter((e) => selectedIds.has(e.id)))}
            className="px-4 py-2.5 rounded-xl font-semibold border border-rose-200 text-rose-700 disabled:opacity-40">
            <Trash2 size={18} />
          </button>
          <button
            disabled={selectedIds.size === 0}
            onClick={() => setMoveCopyEntries((entries || []).filter((e) => selectedIds.has(e.id)))}
            className="flex-1 flex items-center justify-center gap-1 bg-teal-700 text-white py-2.5 rounded-xl font-semibold disabled:opacity-40">
            <ArrowRightLeft size={18} /> {ctx.t("entries.moveOrCopy")} {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
          </button>
        </div>
      ) : canAddEntries && (
        <div className="p-3 border-t border-slate-200 bg-white flex gap-2">
          <button onClick={() => push("addEntry", { bookId, type: "in" })}
            className="flex-1 flex items-center justify-center gap-1 bg-emerald-700 text-white py-2.5 rounded-xl font-semibold">
            <Plus size={18} /> {ctx.t("entries.cashIn")}
          </button>
          <button onClick={() => push("addEntry", { bookId, type: "out" })}
            className="flex-1 flex items-center justify-center gap-1 bg-rose-700 text-white py-2.5 rounded-xl font-semibold">
            <Minus size={18} /> {ctx.t("entries.cashOut")}
          </button>
        </div>
      )}

      {moveCopyEntries && (
        <MoveCopyModal entries={moveCopyEntries} otherBooks={otherBooks} cur={cur} activeLedgerId={activeLedger?.id}
          onClose={() => setMoveCopyEntries(null)} onAction={doMoveOrCopy} t={ctx.t} />
      )}

      {deleteConfirmEntries && (
        <ConfirmModal
          title={deleteConfirmEntries.length === 1 ? ctx.t("entries.deleteConfirmTitleOne") : ctx.t("entries.deleteConfirmTitleOther", { count: deleteConfirmEntries.length })}
          message={ctx.t("entries.deleteConfirmMessage")}
          confirmLabel={ctx.t("entries.deleteYes")} cancelLabel={ctx.t("common.no")}
          onCancel={() => setDeleteConfirmEntries(null)} onConfirm={doDeleteSelected} />
      )}
    </div>
  );
}

function EntryRow({ e, cur, balanceText, t, fmtDate, fmtTime, selectMode, selected, onTap, onLongPress }) {
  const timerRef = useRef(null);
  const longPressed = useRef(false);

  const start = () => {
    longPressed.current = false;
    timerRef.current = setTimeout(() => { longPressed.current = true; onLongPress(); }, 500);
  };
  const cancel = () => { if (timerRef.current) clearTimeout(timerRef.current); };
  const handleClick = () => { if (!longPressed.current) onTap(); };

  return (
    <button
      onMouseDown={start} onMouseUp={cancel} onMouseLeave={cancel}
      onTouchStart={start} onTouchEnd={cancel} onTouchMove={cancel}
      onContextMenu={(ev) => { ev.preventDefault(); onLongPress(); }}
      onClick={handleClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 select-none ${selected ? "bg-teal-50" : ""}`}>
      {selectMode && (
        <div className="shrink-0 text-teal-700">
          {selected ? <CheckCircle2 size={20} /> : <Circle size={20} className="text-slate-300" />}
        </div>
      )}
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${e.type === "in" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
        {e.type === "in" ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-900 truncate flex items-center gap-1.5">
          {e.remark || e.contact || categoryLabel(t, e.category) || (e.type === "in" ? t("entries.cashIn") : t("entries.cashOut"))}
          {e.receipt && <Paperclip size={12} className="text-slate-400 shrink-0" />}
        </div>
        <div className="text-xs text-slate-500 truncate">{fmtDate(e.date)} · {fmtTime(e.time)} · {paymentModeLabel(t, e.paymentMode)}{e.addedBy && e.addedBy !== "You" ? ` · ${t("entries.byPrefix", { name: e.addedBy })}` : ""}</div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-semibold ${e.type === "in" ? "text-emerald-700" : "text-rose-700"}`}>
          {e.type === "in" ? "+" : "-"}{cur}{e.amount.toLocaleString()}
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5">{t("entries.balancePrefix")} {cur}{balanceText}</div>
      </div>
    </button>
  );
}

// Simple Yes/No confirmation prompt — used before any destructive action (deleting
// entries) so an accidental tap doesn't lose data.
function ConfirmModal({ title, message, confirmLabel = "Yes", cancelLabel = "No", danger = true, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm bg-white rounded-2xl p-5" onClick={(ev) => ev.stopPropagation()}>
        <div className="font-semibold text-slate-900 text-base">{title}</div>
        {message && <div className="text-sm text-slate-500 mt-1.5">{message}</div>}
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl font-semibold border border-slate-300 text-slate-600">{cancelLabel}</button>
          <button onClick={onConfirm} className={`flex-1 py-2.5 rounded-xl font-semibold text-white ${danger ? "bg-rose-700" : "bg-teal-700"}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function MoveCopyModal({ entries, otherBooks, cur, activeLedgerId, onClose, onAction, t }) {
  const single = entries.length === 1 ? entries[0] : null;
  const totalAmount = entries.reduce((s, e) => s + (e.type === "in" ? e.amount : -e.amount), 0);

  // Group targets by ledger — current ledger first (unlabeled, since that's the
  // common case), then every other ledger under its own header, so it's always clear
  // which ledger a book belongs to before moving/copying money into it.
  const grouped = [];
  const byBiz = new Map();
  for (const b of otherBooks) {
    if (!byBiz.has(b.ledgerId)) byBiz.set(b.ledgerId, []);
    byBiz.get(b.ledgerId).push(b);
  }
  if (byBiz.has(activeLedgerId)) grouped.push({ ledgerId: activeLedgerId, ledgerName: null, books: byBiz.get(activeLedgerId) });
  for (const [ledgerId, books] of byBiz) {
    if (ledgerId === activeLedgerId) continue;
    grouped.push({ ledgerId, ledgerName: books[0]?.ledgerName, books });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-t-2xl max-h-[75vh] flex flex-col" onClick={(ev) => ev.stopPropagation()}>
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-slate-900">{single ? t("moveCopyModal.titleSingle") : t("moveCopyModal.titleMultiple", { count: entries.length })}</div>
            <button onClick={onClose} className="p-1 text-slate-400"><X size={18} /></button>
          </div>
          <div className="text-sm text-slate-500 mt-1">
            {single
              ? t("moveCopyModal.entrySummary", { sign: single.type === "in" ? "+" : "-", amount: `${cur}${single.amount.toLocaleString()}`, label: single.contact || categoryLabel(t, single.category) || (single.type === "in" ? t("entries.cashIn") : t("entries.cashOut")) })
              : t("moveCopyModal.entriesSelectedSummary", { count: entries.length, sign: totalAmount >= 0 ? "+" : "-", amount: `${cur}${Math.abs(totalAmount).toLocaleString()}` })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {otherBooks.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">{t("moveCopyModal.noOtherBooksHint")}</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {grouped.map((g) => (
                <div key={g.ledgerId}>
                  {g.ledgerName && (
                    <div className="px-4 pt-3 pb-1 flex items-center gap-1.5 text-xs font-medium text-slate-400 uppercase bg-slate-50">
                      <Building2 size={12} /> {g.ledgerName}
                    </div>
                  )}
                  {g.books.map((b) => (
                    <div key={b.id} className="flex items-center justify-between px-4 py-3">
                      <div className="font-medium text-slate-800 text-sm">{b.name}</div>
                      <div className="flex gap-2">
                        <button onClick={() => onAction(b.id, "copy")} className="text-xs font-medium border border-teal-700 text-teal-700 rounded-lg px-3 py-1.5">{t("moveCopyModal.copyButton")}</button>
                        <button onClick={() => onAction(b.id, "move")} className="text-xs font-medium bg-teal-700 text-white rounded-lg px-3 py-1.5">{t("moveCopyModal.moveButton")}</button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// ---------- Entry detail ----------
function EntryDetailScreen({ ctx, bookId, entryId }) {
  const { pop, push, getEntries, appSettings, activeLedger, canAddEntries, t } = ctx;
  const book = activeLedger?.books.find((b) => b.id === bookId);
  const cur = bookCurrency(book, appSettings);
  const [entry, setEntry] = useState(null);

  useEffect(() => {
    getEntries(bookId).then((es) => setEntry(es.find((e) => e.id === entryId) || null));
  }, [bookId, entryId]);

  if (!entry) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <TopHeader ctx={ctx} title={t("entryDetail.title")} onBack={pop} />
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-700" size={24} /></div>
      </div>
    );
  }

  const isIn = entry.type === "in";
  const methodKind = entry.paymentMode === "Cash" ? t("entryDetail.methodCash") : t("entryDetail.methodElectronic");

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={ctx.t("entryDetail.title")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className={`rounded-xl p-4 text-center ${isIn ? "bg-emerald-50" : "bg-rose-50"}`}>
          <div className={`text-xs font-medium ${isIn ? "text-emerald-800" : "text-rose-800"}`}>{isIn ? ctx.t("entries.cashIn") : ctx.t("entries.cashOut")}</div>
          <div className={`text-2xl font-bold ${isIn ? "text-emerald-800" : "text-rose-800"}`}>{cur}{entry.amount.toLocaleString()}</div>
          <div className="text-xs text-slate-500 mt-1">{methodKind} · {paymentModeLabel(t, entry.paymentMode)}</div>
        </div>

        {entry.receipt && (
          <img src={entry.receipt} alt={t("entryDetail.receiptAlt")} className="w-full max-h-72 object-contain rounded-xl border border-slate-200 bg-white" />
        )}

        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {entry.contact && (
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">{isIn ? ctx.t("entryDetail.receivedFrom") : ctx.t("entryDetail.paidTo")}</span>
              <span className="text-sm font-medium text-slate-800">{entry.contact}</span>
            </div>
          )}
          {entry.category && (
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">{ctx.t("entryDetail.category")}</span>
              <span className="text-sm font-medium text-slate-800">{categoryLabel(ctx.t, entry.category)}</span>
            </div>
          )}
          {entry.remark && (
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">{ctx.t("entryDetail.remark")}</span>
              <span className="text-sm font-medium text-slate-800">{entry.remark}</span>
            </div>
          )}
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-slate-500">{ctx.t("entryDetail.date")}</span>
            <span className="text-sm font-medium text-slate-800">{ctx.fmtDate(entry.date)} · {ctx.fmtTime(entry.time)}</span>
          </div>
        </div>

        {canAddEntries && (
          <button onClick={() => push("addEntry", { bookId, editEntry: entry })}
            className="w-full bg-teal-700 text-white py-2.5 rounded-xl font-semibold">
            {ctx.t("entryDetail.editEntry")}
          </button>
        )}

        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          <div className="px-4 py-3">
            <div className="text-xs text-slate-500 mb-0.5">{ctx.t("entryDetail.createdBy")}</div>
            <div className="text-sm font-medium text-slate-800">{entry.addedBy || "You"}{entry.createdAt ? ` · ${ctx.fmtDateTime(entry.createdAt)}` : ""}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-slate-500 mb-0.5">{ctx.t("entryDetail.lastEditedBy")}</div>
            <div className="text-sm font-medium text-slate-800">
              {entry.editedBy ? `${entry.editedBy} · ${ctx.fmtDateTime(entry.editedAt)}` : ctx.t("entryDetail.neverEdited")}
            </div>
          </div>
          {entry.transferredFrom && (
            <div className="px-4 py-3">
              <div className="text-xs text-slate-500 mb-0.5">{ctx.t("entryDetail.lastTransferredFrom")}</div>
              <div className="text-sm font-medium text-slate-800">{entry.transferredFrom} · {ctx.fmtDateTime(entry.transferredAt)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Add / Edit entry ----------
function AddEntryScreen({ ctx, bookId, type, editEntry }) {
  const { pop, getEntries, saveEntries, appSettings, logActivity, viewer, activeLedger, setBackHandler, t } = ctx;
  const isEdit = !!editEntry;
  const book = activeLedger?.books.find((b) => b.id === bookId);
  const bookCur = bookCurrency(book, appSettings);
  const [form, setForm] = useState(() => editEntry
    ? { ...editEntry, time: to24h(editEntry.time) }
    : { type: type || "in", date: todayStr(), time: nowTimeStr24(), amount: "", contact: "", remark: "", category: "", paymentMode: "Cash", receipt: null });
  const [showMoreModes, setShowMoreModes] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setBackHandler?.(() => {
      if (confirmDelete) { setConfirmDelete(false); return true; }
      return false;
    });
    return () => setBackHandler?.(null);
  }, [confirmDelete, setBackHandler]);

  const onReceiptChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, receipt: reader.result }));
    reader.readAsDataURL(file);
  };

  useEffect(() => { getEntries(bookId).then((es) => {
    setContacts([...new Set(es.map(e => e.contact).filter(Boolean))]);
  }); }, [bookId]);

  const save = async (addAnother) => {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return;
    const es = await getEntries(bookId);
    let next;
    if (isEdit) {
      const payload = { ...form, amount: amt, addedBy: editEntry.addedBy, createdAt: editEntry.createdAt, editedBy: viewer.name, editedAt: new Date().toISOString() };
      next = es.map((e) => e.id === editEntry.id ? { ...payload, id: editEntry.id } : e);
      await logActivity(bookId, "activity.editedEntry", { name: viewer.name, amount: `${bookCur}${amt}` });
    } else {
      const payload = { ...form, amount: amt, addedBy: viewer.name };
      next = [...es, { ...payload, id: uid(), createdAt: new Date().toISOString() }];
      await logActivity(bookId, "activity.addedEntry", { name: viewer.name, type: form.type === "in" ? "entries.cashIn" : "entries.cashOut", amount: `${bookCur}${amt}` });
    }
    await saveEntries(bookId, next);
    if (addAnother) {
      setForm({ type: form.type, date: form.date, time: nowTimeStr24(), amount: "", contact: "", remark: "", category: "", paymentMode: form.paymentMode, receipt: null });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } else {
      pop();
    }
  };

  const deleteEntry = async () => {
    const es = await getEntries(bookId);
    await saveEntries(bookId, es.filter((e) => e.id !== editEntry.id));
    await logActivity(bookId, "activity.deletedEntriesOne", { name: viewer.name });
    pop();
  };

  const isIn = form.type === "in";
  const modes = appSettings.paymentModes;
  const visibleModes = showMoreModes ? modes : modes.slice(0, 2);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={isEdit ? t("addEntry.titleEdit") : (isIn ? t("addEntry.titleAddIn") : t("addEntry.titleAddOut"))} onBack={pop}
        right={isEdit ? <button onClick={() => setConfirmDelete(true)} className="p-2 text-rose-700"><Trash2 size={18} /></button> : null} />
      {confirmDelete && (
        <ConfirmModal title={t("entries.deleteConfirmTitleOne")} message={t("entries.deleteConfirmMessage")}
          confirmLabel={t("entries.deleteYes")} cancelLabel={t("common.no")}
          onCancel={() => setConfirmDelete(false)} onConfirm={deleteEntry} />
      )}
      {isEdit && (
        <div className="px-4 pt-3 pb-2 bg-white border-b border-slate-100">
          <div className="text-xs text-slate-500 mb-1.5">{t("addEntry.entryType")}</div>
          <div className="flex gap-2">
            <button onClick={() => setForm({ ...form, type: "in" })}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-xl font-semibold border ${isIn ? "bg-emerald-700 text-white border-emerald-700" : "border-slate-300 text-slate-500"}`}>
              <Plus size={16} /> {t("entries.cashIn")}
            </button>
            <button onClick={() => setForm({ ...form, type: "out" })}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-xl font-semibold border ${!isIn ? "bg-rose-700 text-white border-rose-700" : "border-slate-300 text-slate-500"}`}>
              <Minus size={16} /> {t("entries.cashOut")}
            </button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex gap-3">
          <label className="flex-1">
            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Calendar size={12} /> {t("addEntry.date")}</div>
            <CustomDatePicker value={form.date} onChange={(d) => setForm({ ...form, date: d })} language={ctx.dtPref.language} />
          </label>
          <label className="flex-1">
            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Clock size={12} /> {t("addEntry.time")}</div>
            <CustomTimePicker value={form.time} onChange={(tm) => setForm({ ...form, time: tm })} language={ctx.dtPref.language} timeFormat={ctx.dtPref.timeFormat} />
          </label>
        </div>
        {appSettings.calendarType === "ethiopian" && form.date && (
          <div className="-mt-2 text-xs text-teal-700 flex items-center gap-1">
            <Calendar size={11} /> {ctx.fmtDate(form.date)} · {ctx.fmtTime(form.time)}
          </div>
        )}

        <label className="block">
          <div className="text-xs text-teal-700 mb-1 font-medium">{t("addEntry.amount")}</div>
          <AmountInput autoFocus value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} currencySymbol={bookCur} calcTitle={t("addEntry.calculatorTitle")} />
        </label>

        <label className="block relative">
          <div className="text-xs text-slate-500 mb-1">{isIn ? t("entryDetail.receivedFrom") : t("entryDetail.paidTo")}</div>
          <input list="contacts-list" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder={t("addEntry.addNamePlaceholder")} />
          <datalist id="contacts-list">{contacts.map((c) => <option key={c} value={c} />)}</datalist>
        </label>

        <label className="block">
          <div className="text-xs text-slate-500 mb-1">{t("addEntry.remarkLabel")}</div>
          <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>

        <label className="block">
          <div className="text-xs text-slate-500 mb-1">{t("entryDetail.category")}</div>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">{t("addEntry.selectCategory")}</option>
            {appSettings.categories.map((c) => <option key={c} value={c}>{categoryLabel(t, c)}</option>)}
          </select>
        </label>

        <div>
          <div className="text-xs text-slate-500 mb-1.5">{t("addEntry.receiptLabel")}</div>
          {form.receipt ? (
            <div className="relative inline-block">
              <img src={form.receipt} alt={t("addEntry.receiptAlt")} className="h-24 w-24 object-cover rounded-lg border border-slate-200" />
              <button onClick={() => setForm({ ...form, receipt: null })}
                className="absolute -top-2 -right-2 bg-slate-900 text-white rounded-full p-1"><X size={12} /></button>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2 border border-dashed border-slate-300 rounded-lg py-3 text-sm text-slate-500 cursor-pointer">
              <Camera size={16} /> {t("addEntry.addReceiptHint")}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onReceiptChange} />
            </label>
          )}
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1.5">{t("addEntry.paymentModeLabel")}</div>
          <div className="flex items-center gap-2 flex-wrap">
            {visibleModes.map((m) => (
              <Chip key={m} tone={isIn ? "emerald" : "rose"} active={form.paymentMode === m} onClick={() => setForm({ ...form, paymentMode: m })}>{paymentModeLabel(t, m)}</Chip>
            ))}
            {!showMoreModes && modes.length > 2 && (
              <button onClick={() => setShowMoreModes(true)} className="text-teal-700 text-sm font-medium flex items-center gap-0.5">{t("addEntry.showMore")} <ChevronDown size={14} /></button>
            )}
          </div>
        </div>
      </div>
      {savedFlash && (
        <div className="px-4 py-2 bg-emerald-50 border-t border-emerald-100 flex items-center gap-2 text-emerald-800 text-sm font-medium">
          <CheckCircle2 size={16} /> {t("addEntry.savedFlash")}
        </div>
      )}
      <div className="p-3 border-t border-slate-200 bg-white flex gap-2">
        {!isEdit && (
          <button onClick={() => save(true)} className="flex-1 border border-teal-700 text-teal-700 py-2.5 rounded-xl font-semibold">{t("addEntry.saveAndAddNew")}</button>
        )}
        <button onClick={() => save(false)} className={`flex-1 text-white py-2.5 rounded-xl font-semibold ${isIn ? "bg-emerald-700" : "bg-rose-700"}`}>{t("common.save")}</button>
      </div>
    </div>
  );
}

// ---------- Book settings ----------
function BookSettingsScreen({ ctx, bookId }) {
  const { activeLedger, pop, push, persistLedgers, ledgers, canManage, canAddEntries, session, persistSession, appSettings, getEntries, saveEntries, logActivity, viewer, t } = ctx;
  const book = activeLedger?.books.find((b) => b.id === bookId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(book?.name || "");
  const [confirmDeleteBook, setConfirmDeleteBook] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvMsg, setCsvMsg] = useState(null);
  const csvInputRef = useRef(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState(null);
  const pdfInputRef = useRef(null);

  const onImportCsv = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setCsvBusy(true);
    setCsvMsg(null);
    try {
      const text = await file.text();
      let { entries: parsed, error } = parseEntriesCsv(text, t);
      let guessed = 0;
      if (error) {
        // Not this app's exact 9-column export — try the lenient importer
        // before giving up, so a hand-made spreadsheet (any subset/order of
        // the 9 fields, or no header row at all) can still come in.
        const { parseEntriesCsvFlexible } = await import("./flexibleImport");
        const flexible = parseEntriesCsvFlexible(text, t, { uid, knownPaymentModes: appSettings.paymentModes });
        if (flexible.error) {
          setCsvMsg({ ok: false, text: flexible.error });
          return;
        }
        parsed = flexible.entries;
        guessed = flexible.guessed;
        error = null;
      }
      const existing = await getEntries(bookId);
      await saveEntries(bookId, [...existing, ...parsed]);
      await logActivity(bookId, parsed.length === 1 ? "activity.importedCsvOne" : "activity.importedCsvOther", { name: viewer.name, count: parsed.length });
      const successText = guessed > 0
        ? t("bookSettings.importCsvSuccessGuessed", { count: parsed.length, guessed })
        : t("bookSettings.importCsvSuccess", { count: parsed.length });
      setCsvMsg({ ok: true, text: successText });
    } catch (err) {
      console.error("CSV import failed", err);
      setCsvMsg({ ok: false, text: t("bookSettings.importCsvErrorFormat") });
    } finally {
      setCsvBusy(false);
    }
  };

  const onImportPdf = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setPdfBusy(true);
    setPdfMsg(null);
    try {
      const { parsePdfEntries } = await import("./pdfImport");
      const { entries: parsed, error, skipped } = await parsePdfEntries(file, t, uid);
      if (error) {
        setPdfMsg({ ok: false, text: error });
        return;
      }
      const existing = await getEntries(bookId);
      await saveEntries(bookId, [...existing, ...parsed]);
      await logActivity(bookId, parsed.length === 1 ? "activity.importedPdfOne" : "activity.importedPdfOther", { name: viewer.name, count: parsed.length });
      const successText = skipped > 0
        ? t("bookSettings.importPdfSuccessPartial", { count: parsed.length, skipped })
        : t("bookSettings.importPdfSuccess", { count: parsed.length });
      setPdfMsg({ ok: true, text: successText });
    } catch (err) {
      console.error("PDF import failed", err);
      setPdfMsg({ ok: false, text: t("bookSettings.importPdfErrorFormat") });
    } finally {
      setPdfBusy(false);
    }
  };

  const doRename = async () => {
    const next = ledgers.map((b) => b.id === activeLedger.id ? { ...b, books: b.books.map(bk => bk.id === bookId ? { ...bk, name } : bk) } : b);
    await persistLedgers(next);
    setRenaming(false);
  };

  const setBookCurrency = async (c) => {
    const next = ledgers.map((b) => b.id === activeLedger.id ? { ...b, books: b.books.map(bk => bk.id === bookId ? { ...bk, currency: c } : bk) } : b);
    await persistLedgers(next);
  };

  const deleteBook = async () => {
    const next = ledgers.map((b) => b.id === activeLedger.id ? { ...b, books: b.books.filter(bk => bk.id !== bookId) } : b);
    await persistLedgers(next);
    ctx.resetTo("books");
  };

  const members = activeLedger?.members || [];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("bookSettings.title")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 pb-28 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">{t("bookSettings.cashbookNameLabel")}</div>
          {renaming ? (
            <div className="flex gap-2">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              <button onClick={doRename} className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">{t("common.save")}</button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-900">{book?.name}</div>
              {canManage && <button onClick={() => setRenaming(true)} className="text-teal-700 text-sm font-medium border border-teal-700 rounded-lg px-3 py-1">{t("bookSettings.renameButton")}</button>}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-2">{t("bookSettings.bookCurrencyLabel")}</div>
          <div className="flex gap-2 flex-wrap">
            {Object.keys(CURRENCIES).map((c) => (
              <Chip key={c} active={bookCurrency(book, appSettings) === c} onClick={() => canManage && setBookCurrency(c)}>{c} {CURRENCIES[c]}</Chip>
            ))}
          </div>
          <div className="text-xs text-slate-400 mt-2">{t("bookSettings.bookCurrencyHint")}</div>
        </div>

        {canAddEntries && (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500 mb-2">{t("bookSettings.importCsvTitle")}</div>
            <div className="text-xs text-slate-400 mb-3">{t("bookSettings.importCsvHint")}</div>
            <button onClick={() => csvInputRef.current && csvInputRef.current.click()} disabled={csvBusy}
              className="flex items-center justify-center gap-2 border border-teal-700 text-teal-700 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50">
              <Upload size={16} /> {csvBusy ? t("bookSettings.importCsvBusy") : t("bookSettings.importCsvButton")}
            </button>
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onImportCsv} />
            {csvMsg && <div className={`text-xs mt-2 ${csvMsg.ok ? "text-teal-700" : "text-rose-600"}`}>{csvMsg.text}</div>}
          </div>
        )}

        {canAddEntries && (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500 mb-2">{t("bookSettings.importPdfTitle")}</div>
            <div className="text-xs text-slate-400 mb-3">{t("bookSettings.importPdfHint")}</div>
            <button onClick={() => pdfInputRef.current && pdfInputRef.current.click()} disabled={pdfBusy}
              className="flex items-center justify-center gap-2 border border-teal-700 text-teal-700 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50">
              <Upload size={16} /> {pdfBusy ? t("bookSettings.importPdfBusy") : t("bookSettings.importPdfButton")}
            </button>
            <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={onImportPdf} />
            {pdfMsg && <div className={`text-xs mt-2 ${pdfMsg.ok ? "text-teal-700" : "text-rose-600"}`}>{pdfMsg.text}</div>}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          <div className="px-4 py-2 text-xs font-medium text-slate-400 uppercase">{t("bookSettings.generalSettingsHeader")}</div>
          <button onClick={() => push("activity", { bookId })} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700"><Clock size={16} /></div>
            <div className="flex-1"><div className="font-medium text-slate-900">{t("bookSettings.bookActivityTitle")}</div><div className="text-xs text-slate-500">{t("bookSettings.bookActivitySub")}</div></div>
            <ChevronRight size={16} className="text-slate-300" />
          </button>
          {canManage && (
            <button onClick={() => push("addMember", { bookId })} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
              <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700"><Users size={16} /></div>
              <div className="flex-1"><div className="font-medium text-slate-900">{t("bookSettings.manageMembersTitle")}</div><div className="text-xs text-slate-500">{t("bookSettings.manageMembersSub")}</div></div>
              <ChevronRight size={16} className="text-slate-300" />
            </button>
          )}
        </div>

        {members.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            <div className="px-4 py-2 text-xs font-medium text-slate-400 uppercase">{t("bookSettings.viewAsHeader")}</div>
            <button onClick={async () => { await persistSession({ ...session, viewingAs: null }); }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left ${!session.viewingAs ? "bg-teal-50" : ""}`}>
              <div className="w-8 h-8 rounded-full bg-teal-700 text-white flex items-center justify-center text-xs font-semibold">Y</div>
              <div className="flex-1"><div className="font-medium text-slate-900 text-sm">{t("bookSettings.youLabel")}</div><div className="text-xs text-slate-500">{t("bookSettings.primaryAdminLabel")}</div></div>
              {!session.viewingAs && <Check size={16} className="text-teal-700" />}
            </button>
            {members.map((m) => (
              <button key={m.id} onClick={async () => { await persistSession({ ...session, viewingAs: m.id }); }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left ${session.viewingAs === m.id ? "bg-teal-50" : ""}`}>
                <div className="w-8 h-8 rounded-full bg-slate-300 text-white flex items-center justify-center text-xs font-semibold">{m.name[0]}</div>
                <div className="flex-1"><div className="font-medium text-slate-900 text-sm">{m.name}</div><div className="text-xs text-slate-500">{m.role}</div></div>
                {session.viewingAs === m.id && <Check size={16} className="text-teal-700" />}
              </button>
            ))}
          </div>
        )}

        {canManage && (
          <button onClick={() => setConfirmDeleteBook(true)} className="w-full flex items-center justify-center gap-2 text-rose-700 border border-rose-200 rounded-xl py-3 font-medium">
            <Trash2 size={16} /> {t("bookSettings.deleteButton")}
          </button>
        )}
      </div>

      {confirmDeleteBook && (
        <ConfirmModal
          title={t("bookSettings.deleteConfirmTitle")}
          message={t("bookSettings.deleteConfirmMessage", { name: book?.name })}
          confirmLabel={t("ledgerSettings.deleteConfirmYes")} cancelLabel={t("common.no")}
          onCancel={() => setConfirmDeleteBook(false)}
          onConfirm={() => { setConfirmDeleteBook(false); deleteBook(); }} />
      )}
    </div>
  );
}

// Renders one activity entry. Entries store a translation key + raw params
// (see logActivity) rather than a pre-translated string, so a log stays
// readable if the app's language is changed later — same as every other
// translated string in the app. A couple of params are themselves nested
// translatable values (which role, which entry type) and need one extra
// lookup before the outer message can be interpolated; those are resolved
// here rather than at the call site. `a.text` is a fallback for activity
// entries logged before this change, stored as raw English text.
function activityText(t, a) {
  if (!a.key) return a.text || "";
  const params = { ...a.params };
  if (a.key === "activity.addedEntry" && params.type) params.type = t(params.type);
  if (a.key === "activity.invitedMember" && params.role) params.role = roleLabel(t, params.role);
  return t(a.key, params);
}

function ActivityScreen({ ctx, bookId }) {
  const { pop, getActivity, t } = ctx;
  const [activity, setActivity] = useState(null);
  useEffect(() => { getActivity(bookId).then(setActivity); }, [bookId]);
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("activity.title")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4">
        {activity === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-700" size={24} /></div>
        ) : activity.length === 0 ? (
          <EmptyState icon={Clock} title={t("activity.noActivity")} />
        ) : (
          <div className="space-y-3">
            {activity.map((a) => (
              <div key={a.id} className="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
                <div className="text-sm text-slate-800">{activityText(t, a)}</div>
                <div className="text-xs text-slate-400 mt-0.5">{ctx.fmtDateTime(a.at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Add member ----------
function AddMemberScreen({ ctx, bookId }) {
  const { activeLedger, ledgers, persistLedgers, pop, logActivity, viewer, t } = ctx;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("Data Operator");

  const members = activeLedger?.members || [];

  const addMember = async () => {
    if (!name.trim()) return;
    const m = { id: uid(), name: name.trim(), phone: phone.trim(), role, status: "pending" };
    const next = ledgers.map((b) => b.id === activeLedger.id ? { ...b, members: [...b.members, m] } : b);
    await persistLedgers(next);
    await logActivity(bookId, "activity.invitedMember", { name: viewer.name, member: m.name, role });
    setName(""); setPhone("");
  };

  const changeRole = async (memberId, newRole) => {
    const next = ledgers.map((b) => b.id === activeLedger.id ? { ...b, members: b.members.map(m => m.id === memberId ? { ...m, role: newRole } : m) } : b);
    await persistLedgers(next);
  };

  const removeMember = async (memberId) => {
    const next = ledgers.map((b) => b.id === activeLedger.id ? { ...b, members: b.members.filter(m => m.id !== memberId) } : b);
    await persistLedgers(next);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("members.manageTitle")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
        <div className="text-xs font-medium text-slate-400 uppercase">{t("members.membersLabel")}</div>
        {members.length === 0 && <div className="text-sm text-slate-400">{t("members.noMembers")}</div>}
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.id} className="bg-white border border-slate-200 rounded-xl px-3 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-semibold">{m.name[0]}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 text-sm">{m.name}</div>
                <div className="text-xs text-slate-500">{m.phone || t("members.noPhone")} · {m.status === "pending" ? t("members.statusPending") : t("members.statusActive")}</div>
              </div>
              <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white">
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel(t, r)}</option>)}
              </select>
              <button onClick={() => removeMember(m.id)} className="text-rose-600 p-1"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="font-medium text-slate-800">{t("members.addMember")}</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("members.fullNamePlaceholder")} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("members.phonePlaceholder")} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-2 flex-wrap">
            {ROLES.map((r) => <Chip key={r} active={role === r} onClick={() => setRole(r)}>{roleLabel(t, r)}</Chip>)}
          </div>
          <button onClick={addMember} disabled={!name.trim()}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold ${name.trim() ? "bg-teal-700 text-white" : "bg-slate-200 text-slate-400"}`}>
            <UserPlus size={16} /> {t("members.addMember")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Reports ----------
function ReportsScreen({ ctx, bookId }) {
  const { pop, push, activeLedger, appSettings, t } = ctx;
  const book = activeLedger?.books.find((b) => b.id === bookId);
  const members = activeLedger?.members || [];
  const [duration, setDuration] = useState("allTime");
  const [entryType, setEntryType] = useState("all");
  const [member, setMember] = useState("All");
  const [cats, setCats] = useState([]);
  const [mode, setMode] = useState("All");
  const [reportType, setReportType] = useState("all");

  const toggleCat = (c) => setCats((cs) => cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c]);

  const filters = { duration, entryType, member, cats, paymentMode: mode, reportType, bookName: book?.name };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("reports.title")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-sm font-medium text-slate-700">{t("reports.generateFor")}</div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs text-slate-500 mb-1">{t("reports.durationLabel")}</div>
            <select value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white">
              {["allTime", "thisMonth", "last7", "today"].map(o => <option key={o} value={o}>{reportDurationLabel(t, o)}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-slate-500 mb-1">{t("reports.entryTypeLabel")}</div>
            <select value={entryType} onChange={(e) => setEntryType(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white">
              {["all", "in", "out"].map(o => <option key={o} value={o}>{reportEntryTypeLabel(t, o)}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-slate-500 mb-1">{t("reports.membersLabel")}</div>
            <select value={member} onChange={(e) => setMember(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white">
              <option value="All">{t("entries.all")}</option>
              <option value="You">{t("common.you")}</option>
              {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-slate-500 mb-1">{t("reports.paymentModeLabel")}</div>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white">
              <option value="All">{t("entries.all")}</option>
              {appSettings.paymentModes.map((m) => <option key={m} value={m}>{paymentModeLabel(t, m)}</option>)}
            </select>
          </label>
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1.5">{t("reports.categoriesLabel")}</div>
          <div className="flex flex-wrap gap-2">
            {appSettings.categories.map((c) => <Chip key={c} active={cats.includes(c)} onClick={() => toggleCat(c)}>{categoryLabel(t, c)}</Chip>)}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-slate-700 mb-2">{t("reports.selectReportType")}</div>
          <div className="space-y-2">
            {[
              { id: "all", title: t("reports.allEntriesTitle"), sub: t("reports.allEntriesSub") },
              { id: "category", title: t("reports.categoryTitle"), sub: t("reports.categorySub") },
              { id: "payment", title: t("reports.paymentTitle"), sub: t("reports.paymentSub") },
            ].map((rt) => (
              <button key={rt.id} onClick={() => setReportType(rt.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left ${reportType === rt.id ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-white"}`}>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${reportType === rt.id ? "border-teal-700 bg-teal-700" : "border-slate-300"}`}>
                  {reportType === rt.id && <Check size={12} className="text-white" />}
                </div>
                <div>
                  <div className="font-medium text-slate-900 text-sm">{rt.title}</div>
                  <div className="text-xs text-slate-500">{rt.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="p-3 border-t border-slate-200 bg-white flex gap-2">
        <button onClick={() => push("reportView", { bookId, filters: { ...filters, mode: "excel" } })}
          className="flex-1 flex items-center justify-center gap-2 border border-teal-700 text-teal-700 py-2.5 rounded-xl font-semibold">
          <Download size={16} /> {t("reports.generateExcel")}
        </button>
        <button onClick={() => push("reportView", { bookId, filters: { ...filters, mode: "pdf" } })}
          className="flex-1 flex items-center justify-center gap-2 bg-teal-700 text-white py-2.5 rounded-xl font-semibold">
          <Printer size={16} /> {t("reports.generatePdf")}
        </button>
      </div>
    </div>
  );
}

// Categories/payment modes are stored as their original English words (data
// stays stable across languages, and "Cash" is matched literally elsewhere —
// see entry.paymentMode === "Cash"). Only the default, built-in set below is
// translatable; anything a user typed in themselves (a custom category/mode)
// has no translation to look up and is shown back exactly as typed.
function categoryLabel(t, category) {
  switch (category) {
    case "Home": return t("defaults.categoryHome");
    case "Electronics": return t("defaults.categoryElectronics");
    case "Food": return t("defaults.categoryFood");
    case "Salary": return t("defaults.categorySalary");
    case "Rent": return t("defaults.categoryRent");
    case "Transport": return t("defaults.categoryTransport");
    case "Utilities": return t("defaults.categoryUtilities");
    case "Other": return t("defaults.categoryOther");
    default: return category;
  }
}

// Telebirr/CBE Birr/Coopay are branded service names, not generic concepts —
// they're recognized by these exact names by Ethiopian users regardless of
// app language, the same way "በጅሮንድ" itself stays fixed as the brand mark in
// every language elsewhere in this app. They intentionally have no case here
// and fall through to the default (shown exactly as stored).
function paymentModeLabel(t, mode) {
  switch (mode) {
    case "Cash": return t("defaults.paymentModeCash");
    case "Online": return t("defaults.paymentModeOnline");
    case "Card": return t("defaults.paymentModeCard");
    case "Cheque": return t("defaults.paymentModeCheque");
    default: return mode;
  }
}

function roleLabel(t, role) {
  switch (role) {
    case "Book Admin": return t("roles.bookAdmin");
    case "Data Operator": return t("roles.dataOperator");
    case "Viewer": return t("roles.viewer");
    case "Primary Admin": return t("roles.primaryAdmin");
    default: return role;
  }
}

function reportDurationLabel(t, key) {
  switch (key) {
    case "thisMonth": return t("reports.durationThisMonth");
    case "last7": return t("reports.durationLast7Days");
    case "today": return t("reports.durationToday");
    default: return t("reports.durationAllTime");
  }
}

function reportEntryTypeLabel(t, key) {
  switch (key) {
    case "in": return t("entries.cashIn");
    case "out": return t("entries.cashOut");
    default: return t("entries.all");
  }
}

function applyFilters(entries, f) {
  let list = [...entries];
  const now = new Date();
  if (f.duration === "today") list = list.filter(e => e.date === todayStr());
  else if (f.duration === "last7") {
    const cut = new Date(); cut.setDate(cut.getDate() - 7);
    list = list.filter(e => new Date(e.date) >= cut);
  } else if (f.duration === "thisMonth") {
    list = list.filter(e => new Date(e.date).getMonth() === now.getMonth() && new Date(e.date).getFullYear() === now.getFullYear());
  }
  if (f.entryType === "in") list = list.filter(e => e.type === "in");
  if (f.entryType === "out") list = list.filter(e => e.type === "out");
  if (f.member && f.member !== "All") list = list.filter(e => (e.addedBy || "You") === f.member);
  if (f.cats && f.cats.length) list = list.filter(e => f.cats.includes(e.category));
  if (f.paymentMode && f.paymentMode !== "All") list = list.filter(e => e.paymentMode === f.paymentMode);
  return list;
}

function ReportViewScreen({ ctx, bookId, filters }) {
  const { pop, getEntries, appSettings, activeLedger, t } = ctx;
  const [entries, setEntries] = useState(null);
  useEffect(() => { getEntries(bookId).then(setEntries); }, [bookId]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    return applyFilters(entries, filters);
  }, [entries, filters]);

  const book = activeLedger?.books.find((b) => b.id === bookId);
  const cur = bookCurrency(book, appSettings);
  const totalIn = filtered.filter(e => e.type === "in").reduce((s, e) => s + e.amount, 0);
  const totalOut = filtered.filter(e => e.type === "out").reduce((s, e) => s + e.amount, 0);

  const categorySummary = useMemo(() => {
    const map = {};
    filtered.forEach(e => {
      const k = e.category || t("reportView.uncategorized");
      if (!map[k]) map[k] = { in: 0, out: 0 };
      map[k][e.type] += e.amount;
    });
    return map;
  }, [filtered, t]);

  const paymentSummary = useMemo(() => {
    const map = {};
    filtered.forEach(e => {
      const k = e.paymentMode;
      if (!map[k]) map[k] = { in: 0, out: 0 };
      map[k][e.type] += e.amount;
    });
    return map;
  }, [filtered]);

  const [exporting, setExporting] = useState(false);

  const durationDisplay = reportDurationLabel(t, filters.duration);
  const entryTypeDisplay = reportEntryTypeLabel(t, filters.entryType);
  const reportSubtitle = `${durationDisplay} · ${entryTypeDisplay}${filters.member && filters.member !== "All" ? ` · ${filters.member}` : ""}`;

  const reportTable = () => {
    if (filters.reportType === "all") {
      return {
        headers: ["Date", "Type", "Amount", "Contact/Category"],
        rows: filtered.map(e => [ctx.fmtDate(e.date), e.type === "in" ? "Cash In" : "Cash Out", `${cur}${e.amount.toLocaleString()}`, e.contact || e.category || "-"]),
      };
    } else if (filters.reportType === "category") {
      return {
        headers: ["Category", "Total In", "Total Out"],
        rows: Object.entries(categorySummary).map(([k, v]) => [k, `${cur}${(v.in || 0).toLocaleString()}`, `${cur}${(v.out || 0).toLocaleString()}`]),
      };
    }
    return {
      headers: ["Payment Mode", "Total In", "Total Out"],
      rows: Object.entries(paymentSummary).map(([k, v]) => [k, `${cur}${(v.in || 0).toLocaleString()}`, `${cur}${(v.out || 0).toLocaleString()}`]),
    };
  };

  const downloadCsv = async () => {
    let rows = [];
    if (filters.reportType === "all") {
      rows.push(["Date", "Time", "Type", "Amount", "Contact", "Category", "Payment Mode", "Remark", "Added By"]);
      // CSV Time column stays in plain English AM/PM (or 24h) regardless of app
      // language, so re-importing a CSV later (see parseEntriesCsv) always parses —
      // only the 12h/24h choice from Settings applies here, not the language.
      filtered.forEach(e => rows.push([e.date, fmtTime(e.time, { language: "en", timeFormat: ctx.dtPref.timeFormat }), e.type === "in" ? "Cash In" : "Cash Out", e.amount, e.contact, e.category, e.paymentMode, e.remark, e.addedBy || "You"]));
    } else if (filters.reportType === "category") {
      rows.push(["Category", "Total In", "Total Out"]);
      Object.entries(categorySummary).forEach(([k, v]) => rows.push([k, v.in || 0, v.out || 0]));
    } else {
      rows.push(["Payment Mode", "Total In", "Total Out"]);
      Object.entries(paymentSummary).forEach(([k, v]) => rows.push([k, v.in || 0, v.out || 0]));
    }
    const csv = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    setExporting(true);
    try {
      await saveAndShareFile({ filename: `${filters.bookName || "report"}.csv`, data: csv, mimeType: "text/csv", base64: false });
    } catch (err) {
      console.error("CSV export failed", err);
      alert(t("reportView.csvExportFailed"));
    } finally {
      setExporting(false);
    }
  };

  const downloadPdf = async () => {
    const { headers, rows } = reportTable();
    setExporting(true);
    try {
      const base64 = buildReportPdfBase64({
        title: filters.bookName || "Report",
        subtitle: reportSubtitle,
        totalIn, totalOut, cur, headers, rows,
      });
      await saveAndShareFile({ filename: `${filters.bookName || "report"}.pdf`, data: base64, mimeType: "application/pdf", base64: true });
    } catch (err) {
      console.error("PDF export failed", err);
      alert(t("reportView.pdfExportFailed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("reportView.title")} onBack={pop}
        right={<button onClick={downloadPdf} disabled={exporting} className="p-2 text-teal-700 disabled:opacity-40"><Printer size={18} /></button>} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4" id="report-printable">
        <div className="text-center">
          <div className="font-bold text-slate-900">{filters.bookName}</div>
          <div className="text-xs text-slate-500">{durationDisplay} · {entryTypeDisplay} {filters.member && filters.member !== "All" ? `· ${filters.member}` : ""}</div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1 bg-emerald-50 rounded-xl p-3 text-center">
            <div className="text-xs text-emerald-800">{t("reportView.totalIn")}</div>
            <div className="font-bold text-emerald-800">{cur}{totalIn.toLocaleString()}</div>
          </div>
          <div className="flex-1 bg-rose-50 rounded-xl p-3 text-center">
            <div className="text-xs text-rose-800">{t("reportView.totalOut")}</div>
            <div className="font-bold text-rose-800">{cur}{totalOut.toLocaleString()}</div>
          </div>
        </div>

        {entries === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-700" size={24} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={FileText} title={t("reportView.noMatch")} />
        ) : filters.reportType === "all" ? (
          <div className="divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl overflow-hidden">
            {filtered.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
                <div>
                  <div className="font-medium text-slate-800">{e.contact || categoryLabel(t, e.category) || t("entries.entryFallback")}</div>
                  <div className="text-xs text-slate-400">{ctx.fmtDate(e.date)} · {categoryLabel(t, e.category) || "-"} · {paymentModeLabel(t, e.paymentMode)}</div>
                </div>
                <div className={e.type === "in" ? "text-emerald-700 font-semibold" : "text-rose-700 font-semibold"}>
                  {e.type === "in" ? "+" : "-"}{cur}{e.amount.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        ) : filters.reportType === "category" ? (
          <div className="divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl overflow-hidden">
            {Object.entries(categorySummary).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-3 py-2.5 text-sm">
                <div className="font-medium text-slate-800">{categoryLabel(t, k)}</div>
                <div className="text-right">
                  <div className="text-emerald-700">+{cur}{(v.in || 0).toLocaleString()}</div>
                  <div className="text-rose-700">-{cur}{(v.out || 0).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl overflow-hidden">
            {Object.entries(paymentSummary).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-3 py-2.5 text-sm">
                <div className="font-medium text-slate-800">{paymentModeLabel(t, k)}</div>
                <div className="text-right">
                  <div className="text-emerald-700">+{cur}{(v.in || 0).toLocaleString()}</div>
                  <div className="text-rose-700">-{cur}{(v.out || 0).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="p-3 border-t border-slate-200 bg-white">
        {filters.mode === "excel" ? (
          <button onClick={downloadCsv} disabled={exporting}
            className="w-full flex items-center justify-center gap-2 bg-teal-700 text-white py-2.5 rounded-xl font-semibold disabled:opacity-50">
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {exporting ? t("reportView.preparing") : t("reportView.downloadCsv")}
          </button>
        ) : (
          <button onClick={downloadPdf} disabled={exporting}
            className="w-full flex items-center justify-center gap-2 bg-teal-700 text-white py-2.5 rounded-xl font-semibold disabled:opacity-50">
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
            {exporting ? t("reportView.preparing") : t("reportView.printSavePdf")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Charts ----------
function ChartsScreen({ ctx, bookId }) {
  const { pop, getEntries, appSettings, activeLedger, t } = ctx;
  const book = activeLedger?.books.find((b) => b.id === bookId);
  const cur = bookCurrency(book, appSettings);
  const [entries, setEntries] = useState(null);
  const [groupBy, setGroupBy] = useState("category"); // "category" | "month"

  useEffect(() => { getEntries(bookId).then(setEntries); }, [bookId]);

  const expenseEntries = (entries || []).filter((e) => e.type === "out");
  const totalExpense = expenseEntries.reduce((s, e) => s + e.amount, 0);

  const data = useMemo(() => {
    const map = {};
    expenseEntries.forEach((e) => {
      const key = groupBy === "category"
        ? categoryLabel(t, e.category) || t("reportView.uncategorized")
        : new Date(e.date + "T00:00:00").toLocaleDateString(intlLocale(ctx.dtPref.language, ctx.dtPref.calendarType), { month: "short", year: "numeric" });
      map[key] = (map[key] || 0) + e.amount;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [entries, groupBy, t]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("charts.title")} subtitle={book?.name} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex gap-2">
          <Chip active={groupBy === "category"} tone="rose" onClick={() => setGroupBy("category")}>{t("charts.byCategory")}</Chip>
          <Chip active={groupBy === "month"} tone="rose" onClick={() => setGroupBy("month")}>{t("charts.byMonth")}</Chip>
        </div>

        <div className="bg-rose-50 rounded-xl p-3 text-center">
          <div className="text-xs text-rose-800">{t("charts.totalExpenses")}</div>
          <div className="font-bold text-rose-800 text-lg">{cur}{totalExpense.toLocaleString()}</div>
        </div>

        {entries === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-700" size={24} /></div>
        ) : data.length === 0 ? (
          <EmptyState icon={PieChartIcon} title={t("charts.noExpensesTitle")} hint={t("charts.noExpensesHint")} />
        ) : (
          <>
            <div className="bg-white border border-slate-200 rounded-xl p-2" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} paddingAngle={2}>
                    {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `${cur}${Number(v).toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
              {data.map((d, i) => (
                <div key={d.name} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="flex-1 text-slate-800">{d.name}</span>
                  <span className="text-slate-500">{totalExpense ? Math.round((d.value / totalExpense) * 100) : 0}%</span>
                  <span className="font-semibold text-slate-900 w-24 text-right">{cur}{d.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Settings tab ----------
// Groups shown as separate sections on the Appearance screen. "Solid" is
// the original flat color themes, "Pattern" reuses similar palettes but
// with a subtle background pattern (dots/grid/stripes) that only ever
// shows in the gaps between cards — every card and form field still sits
// on a fully solid surface color, so patterns never affect form readability.
// label/sub are looked up at render time via t("theme.options.<id>.label"/"sub")
// so they follow the app's language setting — see src/i18n/*.js "theme.options".
const THEME_OPTIONS = [
  { id: "light", swatches: ["#f8fafc", "#0f766e", "#b45309"], group: "solid" },
  { id: "dark", swatches: ["#0f172a", "#14b8a6", "#f59e0b"], group: "solid" },
  { id: "brown-cream", swatches: ["#f5ede1", "#7c4a25", "#a86b2d"], group: "solid" },
  { id: "pink", swatches: ["#fef7fa", "#d6598e", "#e17ba6"], group: "solid" },
  { id: "islamic", swatches: ["#f4f8f4", "#0f6b3f", "#b8860b"], group: "solid" },
  { id: "minimalist", swatches: ["#fafafa", "#2563eb", "#18181b"], group: "solid" },
  { id: "light-dots", swatches: ["#f8fafc", "#0f766e", "#b45309"], group: "pattern" },
  { id: "dark-grid", swatches: ["#0f172a", "#14b8a6", "#f59e0b"], group: "pattern" },
  { id: "terracotta-waves", swatches: ["#fdf6ee", "#c2410c", "#9a3412"], group: "pattern" },
  { id: "maasai", swatches: ["#fdf6ec", "#c1272d", "#0e7490"], group: "pattern" },
  { id: "holiday-newyear", swatches: ["#0b1f3a", "#d4af37", "#14355e"], group: "holiday" },
  { id: "holiday-genna", swatches: ["#fdf6ec", "#7a1f2b", "#b8860b"], group: "holiday" },
  { id: "holiday-timkat", swatches: ["#eef7fb", "#0369a1", "#b8860b"], group: "holiday" },
  { id: "holiday-eid", swatches: ["#f3f9f4", "#0a5c33", "#b8860b"], group: "holiday" },
  { id: "holiday-enkutatash", swatches: ["#f6faf0", "#4d7c0f", "#ca8a04"], group: "holiday" },
  { id: "holiday-meskel", swatches: ["#f7f3fa", "#6b21a8", "#ca8a04"], group: "holiday" },
  { id: "holiday-christmas", swatches: ["#fdf5f5", "#b91c1c", "#15803d"], group: "holiday" },
  { id: "holiday-madaraka", swatches: ["#fdfaf5", "#bb0000", "#046a38"], group: "holiday" },
  { id: "holiday-mashujaa", swatches: ["#f8f4ee", "#7a1f1f", "#b8860b"], group: "holiday" },
  { id: "holiday-jamhuri", swatches: ["#fdf8f0", "#1a1a1a", "#bb0000"], group: "holiday" },
];
const THEME_GROUP_ORDER = ["solid", "pattern", "holiday"];

function ThemeScreen({ ctx }) {
  const { pop, theme, persistTheme, t } = ctx;
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("theme.title")} subtitle={t("theme.subtitle")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {THEME_GROUP_ORDER.map((group) => (
          <div key={group}>
            <div className="text-xs font-medium text-slate-400 uppercase mb-2 px-1">{t(`theme.groups.${group}`)}</div>
            <div className="space-y-2.5">
              {THEME_OPTIONS.filter((opt) => opt.group === group).map((opt) => {
                const active = theme === opt.id;
                return (
                  <button key={opt.id} onClick={() => persistTheme(opt.id)}
                    className={`w-full flex items-center gap-3 bg-white border rounded-xl p-4 text-left ${active ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`}>
                    <div className="flex shrink-0 rounded-lg overflow-hidden border border-slate-200 w-10 h-10">
                      {opt.swatches.map((c, i) => <div key={i} className="flex-1 h-full" style={{ backgroundColor: c }} />)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900 text-sm">{t(`theme.options.${opt.id}.label`)}</div>
                      <div className="text-xs text-slate-500">{t(`theme.options.${opt.id}.sub`)}</div>
                    </div>
                    {active ? <CheckCircle2 size={20} className="text-teal-700 shrink-0" /> : <Circle size={20} className="text-slate-200 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Language ----------
function LanguageScreen({ ctx }) {
  const { pop, push, language, persistLanguage, t } = ctx;
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("language.title")} subtitle={t("language.subtitle")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden bg-white">
          {LANGUAGES.map((l) => {
            const active = language === l.code;
            return (
              <button key={l.code} onClick={() => persistLanguage(l.code)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left">
                <span className="font-medium text-slate-800">{l.nativeName}</span>
                {active ? <CheckCircle2 size={20} className="text-teal-700" /> : <Circle size={20} className="text-slate-200" />}
              </button>
            );
          })}
        </div>
        <button onClick={() => push("suggestTranslation")}
          className="w-full mt-3 flex items-center justify-center gap-2 text-teal-700 text-sm font-medium py-2.5">
          <MessageSquarePlus size={16} /> {t("suggestTranslation.linkLabel")}
        </button>
      </div>
    </div>
  );
}

// ---------- Suggest a translation (crowdsourced translation feedback) ----------
// Fully offline like the rest of the app — suggestions sit in local storage
// until the person explicitly taps Share, which hands them to the OS share
// sheet. Nothing is ever sent automatically or over a network.
function SuggestTranslationScreen({ ctx }) {
  const { pop, language, t } = ctx;
  const [list, setList] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [note, setNote] = useState("");
  const [addedFlash, setAddedFlash] = useState(false);

  useEffect(() => { getSuggestions().then((s) => { setList(s); setLoaded(true); }); }, []);

  const languageName = LANGUAGES.find((l) => l.code === language)?.nativeName || language;

  const submit = async () => {
    if (!text.trim() || !suggestion.trim()) return;
    const next = await addSuggestion({ language, languageName, text, suggestion, note });
    setList(next);
    setText(""); setSuggestion(""); setNote("");
    setAddedFlash(true);
    setTimeout(() => setAddedFlash(false), 1800);
  };

  const remove = async (id) => {
    if (!confirm(t("suggestTranslation.deleteConfirmTitle"))) return;
    setList(await removeSuggestion(id));
  };

  const share = async () => {
    try { await shareSuggestions(list); } catch (e) { console.error("share failed", e); }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("suggestTranslation.title")}
        subtitle={t("suggestTranslation.subtitle", { language: languageName })} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <label className="block">
            <div className="text-xs text-slate-500 mb-1">{t("suggestTranslation.textLabel")}</div>
            <input value={text} onChange={(e) => setText(e.target.value)}
              placeholder={t("suggestTranslation.textPlaceholder")}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <div className="text-xs text-slate-500 mb-1">{t("suggestTranslation.suggestionLabel")}</div>
            <input value={suggestion} onChange={(e) => setSuggestion(e.target.value)}
              placeholder={t("suggestTranslation.suggestionPlaceholder")}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <div className="text-xs text-slate-500 mb-1">{t("suggestTranslation.noteLabel")}</div>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t("suggestTranslation.notePlaceholder")}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <button onClick={submit} disabled={!text.trim() || !suggestion.trim()}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold ${text.trim() && suggestion.trim() ? "bg-teal-700 text-white" : "bg-slate-200 text-slate-400"}`}>
            <MessageSquarePlus size={16} /> {t("suggestTranslation.addButton")}
          </button>
          {addedFlash && (
            <div className="flex items-center gap-2 text-emerald-800 text-sm font-medium">
              <CheckCircle2 size={16} /> {t("suggestTranslation.addedFlash")}
            </div>
          )}
        </div>

        {loaded && list.length > 0 && (
          <>
            <div className="text-xs font-medium text-slate-400 uppercase">
              {t("suggestTranslation.listTitle", { count: list.length })}
            </div>
            <div className="space-y-2">
              {list.map((s) => (
                <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-3.5">
                  <div className="text-xs text-slate-400 mb-1">{s.languageName || s.language}</div>
                  <div className="text-sm text-slate-500 line-through decoration-slate-300">{s.text}</div>
                  <div className="text-sm font-medium text-slate-900 mt-0.5">{s.suggestion}</div>
                  {s.note && <div className="text-xs text-slate-500 mt-1">{s.note}</div>}
                  <button onClick={() => remove(s.id)} className="text-rose-600 text-xs mt-2 flex items-center gap-1">
                    <Trash2 size={12} /> {t("common.delete")}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {loaded && list.length === 0 && (
          <EmptyState icon={MessageSquarePlus} title={t("suggestTranslation.emptyTitle")} hint={t("suggestTranslation.emptyHint")} />
        )}
      </div>
      {list.length > 0 && (
        <div className="p-3 border-t border-slate-200 bg-white">
          <button onClick={share} className="w-full flex items-center justify-center gap-2 bg-teal-700 text-white py-2.5 rounded-xl font-semibold">
            <Share2 size={16} /> {t("suggestTranslation.shareButton")}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Quick Access (home screen widget / floating icon) ----------
function QuickAccessScreen({ ctx }) {
  const { pop, t } = ctx;
  const native = Capacitor.isNativePlatform();
  const [overlayGranted, setOverlayGranted] = useState(false);
  const [bubbleOn, setBubbleOn] = useState(false);
  const [widgetSupported, setWidgetSupported] = useState(true);
  const [busy, setBusy] = useState(false);

  const refreshState = useCallback(async () => {
    if (!native) return;
    try {
      const perm = await TallyWidget.hasOverlayPermission();
      setOverlayGranted(!!perm?.value);
    } catch { /* plugin not available (e.g. iOS/dev preview) */ }
    const saved = await storeGet("quick-access-bubble-on", false);
    setBubbleOn(saved);
  }, [native]);

  useEffect(() => { refreshState(); }, [refreshState]);
  // Overlay permission is granted from a system Settings screen outside the app,
  // so re-check whenever the user comes back to this screen rather than only once.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refreshState(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshState]);

  const addWidget = async () => {
    if (!native) return;
    setBusy(true);
    try {
      const res = await TallyWidget.requestPinWidget();
      if (res && res.supported === false) setWidgetSupported(false);
    } catch { setWidgetSupported(false); }
    setBusy(false);
  };

  const toggleBubble = async () => {
    if (!native) return;
    setBusy(true);
    try {
      if (!bubbleOn) {
        const perm = await TallyWidget.hasOverlayPermission();
        if (!perm?.value) {
          await TallyWidget.requestOverlayPermission();
          setBusy(false);
          return; // user needs to grant it in system Settings, then flip the toggle again
        }
        const res = await TallyWidget.startBubble();
        if (res?.started) { setBubbleOn(true); await storeSet("quick-access-bubble-on", true); }
      } else {
        await TallyWidget.stopBubble();
        setBubbleOn(false);
        await storeSet("quick-access-bubble-on", false);
      }
    } catch (e) { console.error("bubble toggle failed", e); }
    setBusy(false);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("quickAccess.title")} subtitle={t("quickAccess.subtitle")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!native && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            {t("quickAccess.previewNote")}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><LayoutGrid size={18} /></div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-900">{t("quickAccess.widgetTitle")}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {t("quickAccess.widgetDesc")}
              </div>
            </div>
          </div>
          {widgetSupported ? (
            <button onClick={addWidget} disabled={!native || busy}
              className="w-full mt-3 bg-teal-700 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
              {t("quickAccess.addWidgetButton")}
            </button>
          ) : (
            <div className="text-xs text-slate-500 mt-3">
              {t("quickAccess.widgetUnsupported")}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Move size={18} /></div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-900">{t("quickAccess.bubbleTitle")}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {t("quickAccess.bubbleDesc")}
              </div>
            </div>
            <button onClick={toggleBubble} disabled={!native || busy}
              className={`shrink-0 w-11 h-6 rounded-full relative transition-colors ${bubbleOn ? "bg-teal-700" : "bg-slate-200"} disabled:opacity-50`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${bubbleOn ? "left-5" : "left-0.5"}`} />
            </button>
          </div>
          {native && !overlayGranted && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mt-3">
              {t("quickAccess.overlayHint")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsScreen({ ctx }) {
  const { push, t } = ctx;
  const Item = ({ icon: Icon, title, sub, onClick }) => (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
      <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Icon size={16} /></div>
      <div className="flex-1"><div className="font-medium text-slate-900">{title}</div><div className="text-xs text-slate-500">{sub}</div></div>
      <ChevronRight size={16} className="text-slate-300" />
    </button>
  );
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("settings.title")} />
      <div className="flex-1 overflow-y-auto pb-28">
        {(IS_BUNDLE || APP_VARIANT === "expenses-manager") && (
          <div className="divide-y divide-slate-100 bg-white">
            <Item icon={Users} title={t("settings.ledgerTeamTitle")} sub={t("settings.ledgerTeamSub")} onClick={() => push("ledgerTeam")} />
            <Item icon={ArrowRightLeft} title={t("settings.moveRequestsTitle")} sub={t("settings.moveRequestsSub")} onClick={() => push("moveRequests")} />
            <Item icon={Building2} title={t("settings.ledgerSettingsTitle")} sub={t("settings.ledgerSettingsSub")} onClick={() => push("ledgerSettings")} />
          </div>
        )}
        <div className="px-4 py-2 text-xs font-medium text-slate-400 uppercase bg-slate-100">{t("settings.generalSettings")}</div>
        <div className="divide-y divide-slate-100 bg-white">
          <Item icon={SettingsIcon} title={t("settings.appSettingsTitle")} sub={t("settings.appSettingsSub")} onClick={() => push("appSettings")} />
          <Item icon={Bell} title={t("settings.remindersTitle")} sub={t("settings.remindersSub")} onClick={() => push("reminders")} />
          <Item icon={Palette} title={t("settings.appearanceTitle")} sub={t("settings.appearanceSub")} onClick={() => push("theme")} />
          <Item icon={Languages} title={t("settings.languageTitle")} sub={t("settings.languageSub")} onClick={() => push("language")} />
          <Item icon={LayoutGrid} title={t("settings.quickAccessTitle")} sub={t("settings.quickAccessSub")} onClick={() => push("quickAccess")} />
          <Item icon={Eye} title={t("settings.profileTitle")} sub={t("settings.profileSub")} onClick={() => push("profile")} />
          <Item icon={Download} title={t("settings.backupTitle")} sub={t("settings.backupSub")} onClick={() => push("backup")} />
          <Item icon={Info} title={t("settings.aboutTitle")} sub={t("settings.aboutSub")} onClick={() => push("about")} />
        </div>
      </div>
    </div>
  );
}

function LedgerTeamScreen({ ctx }) {
  const { activeLedger, ledgers, persistLedgers, pop, t } = ctx;
  const members = activeLedger?.members || [];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("Data Operator");

  const addMember = async () => {
    if (!name.trim() || !activeLedger) return;
    const m = { id: uid(), name: name.trim(), phone: phone.trim(), role, status: "pending" };
    const next = ledgers.map((b) => b.id === activeLedger.id ? { ...b, members: [...b.members, m] } : b);
    await persistLedgers(next);
    setName(""); setPhone(""); setRole("Data Operator"); setAdding(false);
  };

  const removeMember = async (memberId) => {
    const next = ledgers.map((b) => b.id === activeLedger.id ? { ...b, members: b.members.filter(m => m.id !== memberId) } : b);
    await persistLedgers(next);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("members.teamTitle")} onBack={pop}
        right={<button onClick={() => setAdding((v) => !v)} className="p-2 text-teal-700"><UserPlus size={18} /></button>} />
      <div className="flex-1 overflow-y-auto p-4 space-y-2 pb-28">
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-teal-700 text-white flex items-center justify-center font-semibold">Y</div>
          <div className="flex-1"><div className="font-medium text-slate-900 text-sm">{t("common.you")}</div><div className="text-xs text-slate-500">{roleLabel(t, "Primary Admin")}</div></div>
          <ShieldCheck size={16} className="text-teal-700" />
        </div>

        {adding && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="font-medium text-slate-800">{t("members.addMember")}</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("members.fullNamePlaceholder")} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("members.phonePlaceholder")} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <div className="flex gap-2 flex-wrap">
              {ROLES.map((r) => <Chip key={r} active={role === r} onClick={() => setRole(r)}>{roleLabel(t, r)}</Chip>)}
            </div>
            <button onClick={addMember} disabled={!name.trim()}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold ${name.trim() ? "bg-teal-700 text-white" : "bg-slate-200 text-slate-400"}`}>
              <UserPlus size={16} /> {t("members.addMember")}
            </button>
          </div>
        )}

        {members.length === 0 && !adding ? (
          <EmptyState icon={Users} title={t("members.noTeamTitle")} hint={t("members.noTeamHint")} />
        ) : members.map((m) => (
          <div key={m.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-300 text-white flex items-center justify-center font-semibold">{m.name[0]}</div>
            <div className="flex-1"><div className="font-medium text-slate-900 text-sm">{m.name}</div><div className="text-xs text-slate-500">{roleLabel(t, m.role)} · {m.status === "pending" ? t("members.statusPending") : t("members.statusActive")}</div></div>
            <button onClick={() => removeMember(m.id)} className="text-rose-600 p-1"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MoveRequestsScreen({ ctx }) {
  const { activeLedger, ledgers, persistLedgers, pop, getEntries, saveEntries, logActivity, t } = ctx;
  const requests = (activeLedger?.moveRequests || []);

  const respond = async (reqId, approve) => {
    const req = requests.find(r => r.id === reqId);
    if (!req) return;
    const isCopy = req.mode === "copy";

    if (approve) {
      const fromBiz = ledgers.find(b => b.id === req.fromLedgerId);
      const sourceBook = fromBiz?.books.find(bk => bk.id === req.bookId);
      if (sourceBook) {
        if (isCopy) {
          // Copy: source ledger keeps its book untouched; target gets an
          // independent book (new id) with its own duplicated entries, so
          // editing one copy never affects the other.
          const newBook = { ...sourceBook, id: uid(), createdAt: new Date().toISOString() };
          const sourceEntries = await getEntries(req.bookId);
          await saveEntries(newBook.id, sourceEntries.map(e => ({ ...e })));
          await logActivity(newBook.id, "activity.copiedFromLedger", { ledger: req.fromLedgerName });
          const next = ledgers.map((b) => b.id === activeLedger.id
            ? { ...b, books: [...b.books, newBook], moveRequests: b.moveRequests.filter(r => r.id !== reqId) }
            : b);
          await persistLedgers(next);
        } else {
          // Move: book (and its entries, unmodified under the same id) leaves
          // the source ledger entirely and exists only in the target.
          const next = ledgers.map((b) => {
            if (b.id === req.fromLedgerId) return { ...b, books: b.books.filter(bk => bk.id !== req.bookId) };
            if (b.id === activeLedger.id) return { ...b, books: [...b.books, sourceBook], moveRequests: b.moveRequests.filter(r => r.id !== reqId) };
            return b;
          });
          await persistLedgers(next);
        }
      }
    } else {
      const next = ledgers.map((b) => b.id === activeLedger.id ? { ...b, moveRequests: b.moveRequests.filter(r => r.id !== reqId) } : b);
      await persistLedgers(next);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("moveRequests.title")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {requests.length === 0 ? (
          <EmptyState icon={Inbox} title={t("moveRequests.noRequestsTitle")} hint={t("moveRequests.noRequestsHint")} />
        ) : requests.map((r) => (
          <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="font-medium text-slate-900 text-sm">{r.bookName}</div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${r.mode === "copy" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>
                {r.mode === "copy" ? t("moveRequests.copyBadge") : t("moveRequests.moveBadge")}
              </span>
            </div>
            <div className="text-xs text-slate-500 mb-3">
              {r.mode === "copy" ? t("moveRequests.fromPrefixCopy", { ledger: r.fromLedgerName }) : t("moveRequests.fromPrefixMove", { ledger: r.fromLedgerName })}
            </div>
            <div className="flex gap-2">
              <button onClick={() => respond(r.id, true)} className="flex-1 bg-teal-700 text-white py-2 rounded-lg text-sm font-medium">{t("moveRequests.approve")}</button>
              <button onClick={() => respond(r.id, false)} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded-lg text-sm font-medium">{t("moveRequests.deny")}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LedgerSettingsScreen({ ctx }) {
  const { activeLedger, ledgers, persistLedgers, pop, session, resetTo, t } = ctx;
  const [name, setName] = useState(activeLedger?.name || "");
  const [moveTarget, setMoveTarget] = useState("");
  const [moveBook, setMoveBook] = useState("");
  const [moveMode, setMoveMode] = useState("move"); // "move" | "copy"
  const [confirmDeleteLedger, setConfirmDeleteLedger] = useState(false);

  const rename = async () => {
    const next = ledgers.map((b) => b.id === activeLedger.id ? { ...b, name } : b);
    await persistLedgers(next);
  };

  const requestMove = async () => {
    if (!moveTarget || !moveBook) return;
    const book = activeLedger.books.find(b => b.id === moveBook);
    const req = { id: uid(), bookId: moveBook, bookName: book.name, fromLedgerId: activeLedger.id, fromLedgerName: activeLedger.name, mode: moveMode };
    const next = ledgers.map((b) => b.id === moveTarget ? { ...b, moveRequests: [...(b.moveRequests || []), req] } : b);
    await persistLedgers(next);
    setMoveBook(""); setMoveTarget(""); setMoveMode("move");
  };

  const deleteLedger = async () => {
    const next = ledgers.filter((b) => b.id !== activeLedger.id);
    await persistLedgers(next);
    resetTo("books");
  };

  const bookCount = activeLedger?.books?.length || 0;
  const deleteLedgerMessage = bookCount > 0
    ? t(bookCount === 1 ? "ledgerSettings.deleteConfirmMessageWithBooksOne" : "ledgerSettings.deleteConfirmMessageWithBooksOther", { name: activeLedger.name, count: bookCount })
    : t("ledgerSettings.deleteConfirmMessageNoBooks", { name: activeLedger?.name });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("settings.ledgerSettingsTitle")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">{t("ledgerSettings.nameLabel")}</div>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={rename} className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">{t("common.save")}</button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="font-medium text-slate-800 flex items-center gap-2"><ArrowRightLeft size={16} className="text-teal-700" /> {t("ledgerSettings.moveCopyTitle")}</div>
          {ledgers.length <= 1 ? (
            <div className="text-xs text-slate-500">{t("ledgerSettings.addLedgerFirstHint")}</div>
          ) : activeLedger.books.length === 0 ? (
            <div className="text-xs text-slate-500">{t("ledgerSettings.noBooksHint")}</div>
          ) : (
            <>
              <div className="flex gap-2">
                <button type="button" onClick={() => setMoveMode("move")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${moveMode === "move" ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-600 border-slate-300"}`}>
                  {t("ledgerSettings.moveButton")}
                </button>
                <button type="button" onClick={() => setMoveMode("copy")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${moveMode === "copy" ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-600 border-slate-300"}`}>
                  {t("ledgerSettings.copyButton")}
                </button>
              </div>
              <div className="text-xs text-slate-500">
                {moveMode === "copy"
                  ? t("ledgerSettings.copyModeHint")
                  : t("ledgerSettings.moveModeHint")}
              </div>
              <select value={moveBook} onChange={(e) => setMoveBook(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">{t("ledgerSettings.selectBookPlaceholder")}</option>
                {activeLedger.books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">{t("ledgerSettings.selectTargetPlaceholder")}</option>
                {ledgers.filter(b => b.id !== activeLedger.id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button onClick={requestMove} disabled={!moveTarget || !moveBook}
                className={`w-full py-2.5 rounded-xl font-semibold text-sm ${(!moveTarget || !moveBook) ? "bg-slate-200 text-slate-400" : "bg-teal-700 text-white"}`}>
                {moveMode === "copy" ? t("ledgerSettings.sendCopyRequest") : t("ledgerSettings.sendMoveRequest")}
              </button>
            </>
          )}
        </div>

        <button onClick={() => setConfirmDeleteLedger(true)} className="w-full flex items-center justify-center gap-2 text-rose-700 border border-rose-200 rounded-xl py-3 font-medium">
          <Trash2 size={16} /> {t("ledgerSettings.deleteButton")}
        </button>
      </div>

      {confirmDeleteLedger && (
        <ConfirmModal
          title={t("ledgerSettings.deleteConfirmTitle")}
          message={deleteLedgerMessage}
          confirmLabel={t("ledgerSettings.deleteConfirmYes")} cancelLabel={t("common.no")}
          onCancel={() => setConfirmDeleteLedger(false)}
          onConfirm={() => { setConfirmDeleteLedger(false); deleteLedger(); }} />
      )}
    </div>
  );
}

function AppSettingsScreen({ ctx }) {
  const { appSettings, persistSettings, pop, t } = ctx;
  const [newCat, setNewCat] = useState("");
  const [newMode, setNewMode] = useState("");

  const addCat = async () => {
    if (!newCat.trim()) return;
    await persistSettings({ ...appSettings, categories: [...appSettings.categories, newCat.trim()] });
    setNewCat("");
  };
  const removeCat = async (c) => persistSettings({ ...appSettings, categories: appSettings.categories.filter(x => x !== c) });
  const addMode = async () => {
    if (!newMode.trim()) return;
    await persistSettings({ ...appSettings, paymentModes: [...appSettings.paymentModes, newMode.trim()] });
    setNewMode("");
  };
  const removeMode = async (m) => persistSettings({ ...appSettings, paymentModes: appSettings.paymentModes.filter(x => x !== m) });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("settings.appSettingsTitle")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="font-medium text-slate-800 mb-2">{t("appSettingsScreen.calendarTitle")}</div>
          <div className="text-xs text-slate-500 mb-3">{t("appSettingsScreen.calendarHint")}</div>
          <div className="flex gap-2 flex-wrap">
            <Chip active={(appSettings.calendarType || "gregorian") === "gregorian"} onClick={() => persistSettings({ ...appSettings, calendarType: "gregorian" })}>{t("appSettingsScreen.calendarGregorian")}</Chip>
            <Chip active={appSettings.calendarType === "ethiopian"} onClick={() => persistSettings({ ...appSettings, calendarType: "ethiopian" })}>{t("appSettingsScreen.calendarEthiopian")}</Chip>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="font-medium text-slate-800 mb-2">{t("appSettingsScreen.timeFormatTitle")}</div>
          <div className="flex gap-2 flex-wrap">
            <Chip active={(appSettings.timeFormat || "12h") === "12h"} onClick={() => persistSettings({ ...appSettings, timeFormat: "12h" })}>{t("appSettingsScreen.timeFormat12h")}</Chip>
            <Chip active={appSettings.timeFormat === "24h"} onClick={() => persistSettings({ ...appSettings, timeFormat: "24h" })}>{t("appSettingsScreen.timeFormat24h")}</Chip>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="font-medium text-slate-800 mb-2">{t("appSettingsScreen.currencyTitle")}</div>
          <div className="flex gap-2 flex-wrap">
            {Object.keys(CURRENCIES).map((c) => (
              <Chip key={c} active={appSettings.currency === c} onClick={() => persistSettings({ ...appSettings, currency: c })}>{c} {CURRENCIES[c]}</Chip>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="font-medium text-slate-800 mb-2">{t("appSettingsScreen.categoriesTitle")}</div>
          <div className="flex flex-wrap gap-2 mb-3">
            {appSettings.categories.map((c) => (
              <span key={c} className="flex items-center gap-1 bg-slate-100 rounded-full pl-3 pr-1 py-1 text-sm text-slate-700">
                {categoryLabel(t, c)} <button onClick={() => removeCat(c)} className="p-1 text-slate-400"><X size={12} /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder={t("appSettingsScreen.newCategoryPlaceholder")} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={addCat} className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">{t("common.add")}</button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="font-medium text-slate-800 mb-2">{t("appSettingsScreen.paymentModesTitle")}</div>
          <div className="flex flex-wrap gap-2 mb-3">
            {appSettings.paymentModes.map((m) => (
              <span key={m} className="flex items-center gap-1 bg-slate-100 rounded-full pl-3 pr-1 py-1 text-sm text-slate-700">
                {paymentModeLabel(t, m)} <button onClick={() => removeMode(m)} className="p-1 text-slate-400"><X size={12} /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newMode} onChange={(e) => setNewMode(e.target.value)} placeholder={t("appSettingsScreen.newPaymentModePlaceholder")} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={addMode} className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">{t("common.add")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RemindersScreen({ ctx }) {
  const { pop, t, plannedItems, persistPlanned, appSettings, notifPermission, requestNotifPermission } = ctx;
  const pending = plannedItems.filter((p) => !p.done);

  const setReminder = async (id, iso) => {
    const item = plannedItems.find((p) => p.id === id);
    if (!item) return;
    const nextItem = { ...item, reminderAt: iso };
    await persistPlanned(plannedItems.map((p) => p.id === id ? nextItem : p));
    if (iso) await schedulePlannedReminder(nextItem);
    else await cancelPlannedReminder(item);
  };

  const onAllow = async () => {
    const p = await requestNotifPermission();
    if (p !== "granted") {
      alert(t("reminders.notifDeniedAlert"));
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("reminders.title")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0">
            {notifPermission === "granted" ? <BellRing size={16} /> : <BellOff size={16} />}
          </div>
          <div className="flex-1">
            <div className="font-medium text-slate-800 text-sm">{t("reminders.notifications")}</div>
            <div className="text-xs text-slate-500">
              {notifPermission === "granted" ? t("reminders.notifAllowed") : t("reminders.notifAllowHint")}
            </div>
          </div>
          {notifPermission !== "granted" && (
            <button onClick={onAllow} className="text-xs font-medium text-teal-700 border border-teal-200 rounded-lg px-3 py-1.5 shrink-0">{t("reminders.allowButton")}</button>
          )}
        </div>

        <p className="text-xs text-slate-500 px-1">
          {t("reminders.intro")}
        </p>

        {pending.length === 0 ? (
          <EmptyState icon={Bell} title={t("reminders.emptyTitle")} hint={t("reminders.emptyHint")} />
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-3.5">
                <div className="font-medium text-slate-900 text-sm mb-0.5">{p.desc}</div>
                <div className="text-xs text-slate-500 mb-2">{categoryLabel(t, p.category)} · {appSettings.currency}{Number(p.amount || 0).toLocaleString()}</div>
                <div className="flex gap-2">
                  <CustomDateTimePicker
                    valueIso={p.reminderAt || null}
                    onChange={(iso) => setReminder(p.id, iso)}
                    language={ctx.dtPref.language}
                    timeFormat={ctx.dtPref.timeFormat}
                  />
                  {p.reminderAt && (
                    <button onClick={() => setReminder(p.id, null)} className="text-xs text-rose-600 border border-rose-200 rounded-lg px-2.5 shrink-0">{t("reminders.clear")}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileScreen({ ctx }) {
  const { pop, t } = ctx;
  const [profile, setProfile] = useState({ name: "", mobile: "", email: "" });
  useEffect(() => { storeGet("profile", { name: "", mobile: "", email: "" }).then(setProfile); }, []);
  const save = async (next) => { setProfile(next); await storeSet("profile", next); };
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("profile.title")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <label className="block">
          <div className="text-xs text-slate-500 mb-1">{t("profile.nameLabel")}</div>
          <input value={profile.name} onChange={(e) => save({ ...profile, name: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <div className="text-xs text-slate-500 mb-1">{t("profile.mobileLabel")}</div>
          <input value={profile.mobile} onChange={(e) => save({ ...profile, mobile: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <div className="text-xs text-slate-500 mb-1">{t("profile.emailLabel")}</div>
          <input value={profile.email} onChange={(e) => save({ ...profile, email: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
      </div>
    </div>
  );
}

function BackupRestoreScreen({ ctx }) {
  const { pop, t } = ctx;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const restoreInputRef = useRef(null);

  const doExport = async () => {
    setBusy(true); setMsg(null);
    try {
      await exportProductData(APP_VARIANT);
    } catch (e) {
      setMsg({ ok: false, text: e.message || t("backupRestore.exportFailed") });
    } finally {
      setBusy(false);
    }
  };

  const onRestoreFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const bundle = await readExportFile(file);
      if (bundle.product !== APP_VARIANT) {
        setMsg({ ok: false, text: t("backupRestore.wrongFileError") });
        return;
      }
      const already = await hasExistingData(APP_VARIANT);
      if (already && !confirm(t("backupRestore.replaceConfirm"))) {
        return;
      }
      await importProductData(bundle);
      setMsg({ ok: true, text: t("backupRestore.restoreSuccess") });
      // A restore rewrites storage wholesale (books, entries, settings) — a
      // full reload is the simplest way to get every already-mounted screen
      // back in sync with it, rather than threading a refresh through each
      // piece of state that reads from Preferences on first load only.
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setMsg({ ok: false, text: err.message || t("backupRestore.restoreFailed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("backupRestore.title")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-xs text-slate-500 bg-slate-100 rounded-lg p-3">
          {t("backupRestore.optionalNote")}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Download size={18} /></div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-900 text-sm">{t("backupRestore.exportTitle")}</div>
              <div className="text-xs text-slate-500">{t("backupRestore.exportHint")}</div>
            </div>
          </div>
          <button onClick={doExport} disabled={busy}
            className="w-full mt-3 text-sm font-medium bg-teal-700 text-white rounded-lg px-3 py-2.5 disabled:opacity-50">
            {busy ? t("backupRestore.workingButton") : t("backupRestore.exportButton")}
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Upload size={18} /></div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-900 text-sm">{t("backupRestore.restoreTitle")}</div>
              <div className="text-xs text-slate-500">{t("backupRestore.restoreHint")}</div>
            </div>
          </div>
          <button onClick={() => restoreInputRef.current && restoreInputRef.current.click()} disabled={busy}
            className="w-full mt-3 text-sm font-medium bg-white border border-teal-700 text-teal-700 rounded-lg px-3 py-2.5 disabled:opacity-50">
            {busy ? t("backupRestore.workingButton") : t("backupRestore.restoreButton")}
          </button>
          <input ref={restoreInputRef} type="file" accept=".json,application/json" className="hidden" onChange={onRestoreFile} />
        </div>

        {msg && <div className={`text-sm ${msg.ok ? "text-teal-700" : "text-rose-600"}`}>{msg.text}</div>}
      </div>
    </div>
  );
}

function AboutScreen({ ctx }) {
  const { pop, t } = ctx;
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("about.title")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm text-slate-600">
        <p>{t("about.description")}</p>
        <p>{t("about.privacyNote")}</p>
        <p className="text-xs text-slate-400 pt-4">{t("about.version")}</p>
      </div>
    </div>
  );
}

function HelpScreen({ ctx }) {
  const { pop, t } = ctx;
  const faqKeys = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopHeader ctx={ctx} title={t("help.title")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {faqKeys.map((n) => (
          <div key={n} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="font-medium text-slate-900 text-sm mb-1">{t(`help.q${n}`)}</div>
            <div className="text-sm text-slate-500">{t(`help.a${n}`)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
