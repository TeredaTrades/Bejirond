import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Plus, Minus, ChevronRight, ChevronDown, ArrowLeft, X, Settings as SettingsIcon,
  Users, FileText, Search, MoreVertical, Building2, UserPlus, Info, Smartphone,
  Share2, HelpCircle, BookMarked, Wallet, TrendingUp, TrendingDown, Calendar,
  Clock, Trash2, Download, Printer, Eye, EyeOff, ShieldCheck, Check, ArrowRightLeft,
  Loader2, Inbox, ChevronLeft, PieChart as PieChartIcon, SlidersHorizontal, Camera, Paperclip,
  CheckSquare, CheckCircle2, Circle, ClipboardList, Bell, BellOff, BellRing, Calculator,
  VolumeX, Palette, Sun, Moon, LayoutGrid,
  Upload, Sparkles, Move, Languages
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
const DEFAULT_PAYMENT_MODES = ["Cash", "Online", "Card", "Cheque"];
const CURRENCIES = { "$": "USD", "Br": "ETB", "₹": "INR", "€": "EUR", "£": "GBP" };
const ROLES = ["Book Admin", "Data Operator", "Viewer"];
const BOOK_TEMPLATES = ["Sales Ledger", "Bank Reconciliation", "Shared Cashbook", "Payroll & Staff Expenses"];

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
// Formats a stored time value (either format) as "h:mm AM/PM" for display.
const fmtTime12 = (t) => {
  const raw = (t || "").trim();
  if (!raw) return "";
  const m24 = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (m24) {
    let h = parseInt(m24[1], 10);
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m24[2]} ${ampm}`;
  }
  return raw; // already "h:mm AM/PM"
};
const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
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
const fmtDateTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
async function pushWidgetBalance(businesses, appSettings) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const active = businesses?.[0];
    if (!active) { await TallyWidget.updateBalance({ text: "No businesses yet" }); return; }
    let total = 0;
    for (const biz of businesses) {
      for (const bk of biz.books) {
        const es = await storeGet(`entries:${bk.id}`, []);
        total += es.reduce((s, e) => s + (e.type === "in" ? e.amount : -e.amount), 0);
      }
    }
    const cur = appSettings?.currency || "$";
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

function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 text-slate-400">
      <Icon size={36} className="mb-3 text-slate-300" />
      <div className="font-medium text-slate-500">{title}</div>
      {hint && <div className="text-sm mt-1 max-w-[240px]">{hint}</div>}
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
function AmountInput({ value, onChange, currencySymbol = "", placeholder = "0", autoFocus = false }) {
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
          className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded ${calcOpen ? "text-teal-700" : "text-slate-400"}`} title="Calculator">
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
    // tab/stack below) — it lands straight on the business selector, so there's no
    // Home screen to link to from here.
    // Only the bundle (or the Expenses Manager standalone build) has a
    // dedicated Cashbooks tab — other single-tool builds reach their one
    // tool from the Home card instead.
    (IS_BUNDLE || APP_VARIANT === "expenses-manager") && { id: "books", label: t("nav.cashbooks"), icon: BookMarked },
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
function PlannedFAB({ pendingCount, onClick, hidden }) {
  return (
    <button
      onClick={onClick}
      className={`fixed right-4 bottom-24 z-30 w-14 h-14 rounded-full bg-teal-700 text-white shadow-lg shadow-teal-900/20 flex items-center justify-center active:scale-95 transition-opacity duration-150 ${hidden ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      title="Things to buy / pay for"
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
  const { plannedItems, persistPlanned, appSettings, push } = ctx;
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
            <div className="font-semibold text-slate-900 truncate">To buy / to pay for</div>
            <div className="text-xs text-slate-500 truncate">A running wishlist, separate from your books</div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 shrink-0"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
            {editingId && (
              <div className="flex items-center justify-between text-xs bg-teal-50 text-teal-700 rounded-lg px-2.5 py-1.5">
                Editing item <button onClick={cancelEdit} className="underline font-medium">Cancel</button>
              </div>
            )}
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Rent, groceries, new shoes"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" />
            <div className="flex gap-2">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" placeholder="Anticipated amount"
                className="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" />
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white">
                {appSettings.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button onClick={save} className="w-full bg-teal-700 text-white py-2 rounded-lg text-sm font-medium">
              {editingId ? "Update item" : "Add to list"}
            </button>
          </div>

          <div className="flex items-center justify-between bg-teal-50 border border-teal-100 rounded-xl px-3 py-2.5">
            <span className="text-xs font-medium text-teal-800">Pending total ({pending.length})</span>
            <span className="text-sm font-semibold text-teal-800">{appSettings.currency}{pendingTotal.toLocaleString()}</span>
          </div>

          {plannedItems.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Nothing on your list" hint="Add things you plan to buy or bills you need to pay." />
          ) : (
            <div className="divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl overflow-hidden">
              {[...pending, ...done].map((p) => (
                <div key={p.id} className={`flex items-center gap-2 px-3 py-2.5 ${p.done ? "opacity-50" : ""}`}>
                  <button onClick={() => toggleDone(p)} className="text-teal-700 shrink-0" title={p.done ? "Mark as pending" : "Mark as bought/paid"}>
                    {p.done ? <CheckCircle2 size={18} /> : <Circle size={18} className="text-slate-300" />}
                  </button>
                  <button onClick={() => !p.done && startEdit(p)} className="flex-1 min-w-0 text-left">
                    <div className={`text-sm font-medium text-slate-900 truncate ${p.done ? "line-through" : ""}`}>{p.desc}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1 truncate">
                      <span>{p.category}</span>
                      {p.reminderAt && (
                        <span className="flex items-center gap-0.5 text-teal-700"><Bell size={10} /> {fmtDateTime(p.reminderAt)}</span>
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
            <Bell size={15} /> Manage reminders in Settings
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
function ReminderAlarmModal({ alarm, onDismiss, onMarkDone, onSnooze }) {
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
        <div className="text-xs font-medium text-rose-600 uppercase tracking-wide mb-1">Reminder</div>
        <div className="text-lg font-bold text-slate-900 mb-1">{alarm.desc}</div>
        <div className="text-sm text-slate-500 mb-5">
          {alarm.amount ? `${alarm.currency}${Number(alarm.amount).toLocaleString()} · ` : ""}{alarm.category}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button onClick={() => { stopSound(); onSnooze(); }} className="border border-slate-300 text-slate-700 rounded-xl py-2.5 text-sm font-medium">
            Snooze 10 min
          </button>
          <button onClick={() => { stopSound(); onMarkDone(); }} className="bg-emerald-700 text-white rounded-xl py-2.5 text-sm font-medium">
            Mark done
          </button>
        </div>
        <button onClick={() => { stopSound(); onDismiss(); }} className="w-full flex items-center justify-center gap-1.5 text-slate-500 text-sm py-2">
          <VolumeX size={14} /> Dismiss
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
  // Whether the user has actively confirmed which business they're working in
  // this session. Resets to false on every cold start (like `unlocked`), so a
  // returning user with more than one business lands on the business picker
  // instead of being silently dropped back into whichever one was active last
  // time. Businesses load async, so this starts false and gets flipped true in
  // the initial-load effect once we know there's 0 or 1 business (nothing to
  // pick), or as soon as the user picks/creates one this session.
  const [sessionBusinessConfirmed, setSessionBusinessConfirmed] = useState(false);
  const [businesses, setBusinesses] = useState([]);
  const [session, setSession] = useState({ activeBusinessId: null, viewingAs: null });
  const [appSettings, setAppSettings] = useState({ categories: DEFAULT_CATEGORIES, paymentModes: DEFAULT_PAYMENT_MODES, currency: "$" });
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
  // the business selector (the Cashbooks/"books" tab, which shows the Select Business
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
      const acct = await storeGet("account", null);
      const biz = await storeGet("businesses", []);
      const sess = await storeGet("session", { activeBusinessId: null, viewingAs: null });
      const settings = await storeGet("app-settings", { categories: DEFAULT_CATEGORIES, paymentModes: DEFAULT_PAYMENT_MODES, currency: "$" });
      const savedTheme = await storeGet("app-theme", "light");
      setTheme(savedTheme);
      const savedLanguage = await storeGet("app-language", DEFAULT_LANGUAGE);
      setLanguage(savedLanguage);
      const savedFirstRunDone = await storeGet("first-run-done", false);
      setFirstRunDone(savedFirstRunDone);
      const planned = await storeGet("planned-items", []);
      setAccount(acct);
      setBusinesses(biz);
      setAppSettings(settings);
      setPlannedItems(planned);
      const activeId = sess.activeBusinessId && biz.find(b => b.id === sess.activeBusinessId) ? sess.activeBusinessId : (biz[0]?.id || null);
      setSession({ ...sess, activeBusinessId: activeId });
      // 0 businesses means there's nothing to pick yet (goes to the "create
      // your first business" screen instead). 1+ means it stays false, so the
      // Expenses Manager always lands on the Select Business screen first —
      // see the SwitchBusinessScreen render inside BooksScreen below.
      if (biz.length === 0) setSessionBusinessConfirmed(true);
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
      const settings = await storeGet("app-settings", { categories: DEFAULT_CATEGORIES, paymentModes: DEFAULT_PAYMENT_MODES, currency: "$" });
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

  const persistBusinesses = useCallback(async (next) => {
    setBusinesses(next);
    await storeSet("businesses", next);
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
    await storeSet("first-run-done", true);
  }, []);
  // Mirror the theme onto <html> too, so backgrounds outside the app's root wrapper
  // (e.g. iOS overscroll/bounce edges) match instead of flashing white/black.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
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

  const activeBusiness = businesses.find((b) => b.id === session.activeBusinessId) || null;

  const getEntries = useCallback(async (bookId) => {
    if (entriesCache[bookId]) return entriesCache[bookId];
    const e = await storeGet(`entries:${bookId}`, []);
    setEntriesCache((c) => ({ ...c, [bookId]: e }));
    return e;
  }, [entriesCache]);

  const saveEntries = useCallback(async (bookId, next) => {
    setEntriesCache((c) => ({ ...c, [bookId]: next }));
    await storeSet(`entries:${bookId}`, next);
    pushWidgetBalance(businesses, appSettings);
  }, [businesses, appSettings]);

  const logActivity = useCallback(async (bookId, text) => {
    const cur = activityCache[bookId] || (await storeGet(`activity:${bookId}`, []));
    const next = [{ id: uid(), text, at: new Date().toISOString() }, ...cur].slice(0, 50);
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

  // current viewer identity/role for the active business
  const viewer = useMemo(() => {
    if (!session.viewingAs) return { id: "you", name: "You", role: "Primary Admin" };
    const m = activeBusiness?.members.find((mm) => mm.id === session.viewingAs);
    return m ? { id: m.id, name: m.name, role: m.role } : { id: "you", name: "You", role: "Primary Admin" };
  }, [session.viewingAs, activeBusiness]);

  const canManage = viewer.role === "Primary Admin" || viewer.role === "Book Admin";
  const canAddEntries = canManage || viewer.role === "Data Operator";

  const createBusiness = async (name) => {
    const nb = { id: uid(), name, createdAt: new Date().toISOString(), books: [], members: [], moveRequests: [] };
    const next = [...businesses, nb];
    await persistBusinesses(next);
    await persistSession({ ...session, activeBusinessId: nb.id });
    setSessionBusinessConfirmed(true); // creating one counts as picking it
    return nb;
  };
  const confirmBusinessSelection = useCallback(() => setSessionBusinessConfirmed(true), []);

  const createBook = async (name) => {
    if (!activeBusiness) return;
    const nbBook = { id: uid(), name, createdAt: new Date().toISOString() };
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, books: [...b.books, nbBook] } : b);
    await persistBusinesses(next);
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
          await storeSet("account", acct);
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
          await storeSet("account", null);
          setAccount(null);
        }}
      />
    );
  }

  const ctx = {
    businesses, activeBusiness, session, appSettings, viewer, canManage, canAddEntries,
    persistBusinesses, persistSession, persistSettings,
    getEntries, saveEntries, getActivity, logActivity,
    createBusiness, createBook,
    sessionBusinessConfirmed, confirmBusinessSelection,
    push, pop, resetTo, stack, top,
    plannedItems, persistPlanned, notifPermission, requestNotifPermission,
    theme, persistTheme,
    language, persistLanguage, t,
    setBackHandler: (fn) => { backHandlerRef.current = fn; },
  };

  const pendingPlannedCount = plannedItems.filter((p) => !p.done).length;

  return (
    <div data-theme={theme} className="w-full h-screen bg-slate-50 overflow-hidden flex flex-col relative">
      <div className="flex-1 overflow-y-auto flex flex-col">
        <Router ctx={ctx} tab={tab} setTab={setTab} />
      </div>
      {/* Always visible, not just at the top of the stack — otherwise there was no way back to
          Home (or any other tab) from a nested screen short of tapping the header's back arrow
          all the way out one step at a time. Tapping a tab here always resets to that tab's
          top-level screen regardless of how deep the current stack is. */}
      <BottomNav tab={tab} setTab={(nextTab) => { setTab(nextTab); resetTo(nextTab); }} t={t} />
      <PlannedFAB pendingCount={pendingPlannedCount} onClick={() => setPlannedSidebarOpen(true)} hidden={inputFocused} />
      <PlannedSidebar ctx={ctx} open={plannedSidebarOpen} onClose={() => setPlannedSidebarOpen(false)} />
      <ReminderAlarmModal alarm={activeAlarm} onDismiss={dismissAlarm} onMarkDone={markAlarmDone} onSnooze={snoozeAlarm} />
    </div>
  );
}

// ---------- First run: language + theme picker ----------
// Shown once, for a few seconds, right after the language + theme picker —
// still part of the very-first-launch flow (see firstRunDone/showAboutSplash
// in App). Introduces what "Bejirond" means before the user gets into the
// app itself. Auto-advances on a timer; deliberately has no button/skip
// since it's short by design and the point is just a brief, unhurried
// introduction, not a screen the user has to act on.
function AboutSplashScreen({ theme, t, onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 3500);
    return () => clearTimeout(timer);
  }, [onDone]);
  return (
    <div data-theme={theme} className="w-full h-screen bg-white overflow-hidden flex flex-col items-center justify-center px-8 text-center">
      <Loader2 size={28} className="animate-spin text-teal-700 mb-6" />
      <p className="text-sm text-slate-600 leading-relaxed max-w-[300px]">{t("firstRun.aboutMessage")}</p>
    </div>
  );
}

// Shown once, before Welcome, only on a device's very first launch (see firstRunDone in
// App). Both choices can be changed later from Settings — this just sets a sensible
// starting point instead of forcing English/light on everyone by default.
function FirstRunScreen({ theme, persistTheme, language, persistLanguage, t, onDone }) {
  return (
    <div data-theme={theme} className="w-full h-screen bg-white overflow-hidden flex flex-col">
      <div className="flex-1 overflow-y-auto flex flex-col items-center px-6 pt-14">
        <div className="w-20 h-20 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center mb-6">
          <BookMarked size={36} className="text-teal-700" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 text-center">{t("firstRun.title")}</h1>
        <p className="text-sm text-slate-500 text-center mt-1 mb-8 max-w-[280px]">{t("firstRun.subtitle")}</p>

        <div className="w-full mb-6">
          <div className="text-xs font-medium text-slate-400 uppercase mb-2 px-1">{t("firstRun.languageLabel")}</div>
          <div className="border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden">
            {LANGUAGES.map((l) => {
              const active = language === l.code;
              return (
                <button key={l.code} onClick={() => persistLanguage(l.code)}
                  className="w-full flex items-center justify-between px-4 py-3.5 bg-white">
                  <span className="font-medium text-slate-800">{l.nativeName}</span>
                  {active ? <CheckCircle2 size={20} className="text-teal-700" /> : <Circle size={20} className="text-slate-200" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="w-full mb-6">
          <div className="text-xs font-medium text-slate-400 uppercase mb-2 px-1">{t("firstRun.themeLabel")}</div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => persistTheme("light")}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 ${theme === "light" ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`}>
              <Sun size={22} className="text-amber-500" />
              <span className="text-sm font-medium text-slate-800">{t("firstRun.themeLight")}</span>
            </button>
            <button onClick={() => persistTheme("dark")}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 ${theme === "dark" ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`}>
              <Moon size={22} className="text-indigo-500" />
              <span className="text-sm font-medium text-slate-800">{t("firstRun.themeDark")}</span>
            </button>
          </div>
        </div>
      </div>
      <div className="p-4">
        <button onClick={onDone} className="w-full bg-teal-700 text-white py-3 rounded-xl font-semibold">
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

  const createAccount = () => {
    if (!name.trim()) { setError(t("welcome.errorNameRequired")); return; }
    if (!/^\d{4,6}$/.test(pin)) { setError(t("welcome.errorPinInvalid")); return; }
    if (pin !== pin2) { setError(t("welcome.errorPinMismatch")); return; }
    onDone({ welcomed: true, name: name.trim(), pin });
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
          <BookMarked size={36} className="text-teal-700" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 text-center">{t("welcome.title")}</h1>
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
          <BookMarked size={36} className="text-teal-700" />
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

// ---------- Choose business type (moved out of first launch — now shown inside Expenses
// Manager the first time a business needs to be created, since it's specific to that tool) ----------
function ChooseBusinessType({ onDone, t }) {
  const [choice, setChoice] = useState(null);
  const options = [
    { id: "business", label: t("chooseBusinessType.business"), icon: Building2 },
    { id: "personal", label: t("chooseBusinessType.personal"), icon: Wallet },
    { id: "explore", label: t("chooseBusinessType.explore"), icon: Info },
  ];
  return (
    <div className="w-full h-full bg-white overflow-hidden flex flex-col">
      <div className="flex-1 flex flex-col items-center px-6 pt-10">
        <div className="w-20 h-20 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center mb-8">
          <BookMarked size={36} className="text-teal-700" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 text-center">{t("chooseBusinessType.title")}</h1>
        <p className="text-sm text-slate-500 text-center mt-1 mb-8">{t("chooseBusinessType.subtitle")}</p>
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
          {t("chooseBusinessType.next")} <ChevronRight size={18} />
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
function ImportRow({ product, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const inputRef = useRef(null);
  const scope = PRODUCT_DATA_SCOPES[product.id];
  const hasScope = scope && (scope.exactKeys.length || scope.prefixes.length);

  const onFile = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const exportBundle = await readExportFile(file);
      if (exportBundle.product !== product.id) {
        setMsg({ ok: false, text: `That file is a ${exportBundle.product} export, not ${product.name}.` });
        return;
      }
      const already = await hasExistingData(product.id);
      if (already && !confirm(`This will replace your existing ${product.name} data in this app. Continue?`)) {
        return;
      }
      const result = await importProductData(exportBundle);
      setMsg({ ok: true, text: `Imported ${product.name} data.` });
      onDone && onDone(result);
    } catch (err) {
      setMsg({ ok: false, text: err.message || "Import failed." });
    } finally {
      setBusy(false);
    }
  }, [product, onDone]);

  if (!hasScope) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Upload size={18} /></div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-900 text-sm">{product.name}</div>
          <div className="text-xs text-slate-500">{product.tagline}</div>
        </div>
        <button onClick={() => inputRef.current && inputRef.current.click()} disabled={busy}
          className="shrink-0 text-xs font-medium bg-teal-700 text-white rounded-lg px-3 py-2 disabled:opacity-50">
          {busy ? "Importing…" : "Import file"}
        </button>
        <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
      </div>
      {msg && <div className={`text-xs mt-2 ${msg.ok ? "text-teal-700" : "text-rose-600"}`}>{msg.text}</div>}
    </div>
  );
}

function ProductRow({ product, isBundleCard }) {
  return (
    <div className={`w-full flex items-center gap-3 border rounded-xl p-4 ${isBundleCard ? "bg-teal-700 border-teal-700" : "bg-white border-slate-200"}`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isBundleCard ? "bg-teal-600 text-white" : "bg-slate-50 text-slate-700"}`}>
        {isBundleCard ? <Sparkles size={18} /> : <LayoutGrid size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`font-medium text-sm ${isBundleCard ? "text-white" : "text-slate-900"}`}>{product.name}</div>
        <div className={`text-xs ${isBundleCard ? "text-teal-100" : "text-slate-500"}`}>{product.tagline}</div>
      </div>
      {product.playStoreUrl ? (
        <a href={product.playStoreUrl} target="_blank" rel="noopener noreferrer"
          className={`shrink-0 text-xs font-medium rounded-lg px-3 py-2 ${isBundleCard ? "bg-white text-teal-700" : "bg-slate-800 text-white"}`}>
          Get
        </a>
      ) : (
        // No playStoreUrl yet (see NOTES.md — package IDs not set up yet), so this
        // doesn't link anywhere yet, but stays styled like an active "Get" button
        // rather than a grayed-out "Coming soon" pill.
        <button type="button"
          className={`shrink-0 text-xs font-medium rounded-lg px-3 py-2 ${isBundleCard ? "bg-white text-teal-700" : "bg-slate-800 text-white"}`}>
          Get
        </button>
      )}
    </div>
  );
}

function MoreAppsScreen({ ctx }) {
  const { pop } = ctx;
  const [importedTick, setImportedTick] = useState(0);

  if (IS_BUNDLE) {
    return (
      <div className="flex-1 flex flex-col">
        <TopHeader ctx={ctx} title="Import data" subtitle="Bring data in from a standalone በጅሮንድ app" onBack={pop} />
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="text-xs text-slate-500 px-1">
            If you used one of the single-tool በጅሮንድ apps before switching to the full bundle, export your data from
            that app's Settings, then import the file here.
          </div>
          {PRODUCTS.map((p) => <ImportRow key={p.id} product={p} onDone={() => setImportedTick((t) => t + 1)} />)}
        </div>
      </div>
    );
  }

  const self = productById(APP_VARIANT);
  const others = PRODUCTS.filter((p) => p.id !== APP_VARIANT);

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="More በጅሮንድ Apps" subtitle="Other በጅሮንድ tools" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <ProductRow product={BUNDLE_PRODUCT} isBundleCard />
        <div className="text-xs font-medium text-slate-400 uppercase px-1 pt-2">Also available separately</div>
        {others.map((p) => <ProductRow key={p.id} product={p} />)}
        {/* Not linked yet — waiting on the TeredaTrades URL/Telegram channel to point this at.
            Also shown here (not just Home) since the Expenses Manager standalone build has no
            Home screen, so this is its only route to it. */}
        <button className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-4 text-left">
          <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><TrendingUp size={18} /></div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-slate-900 text-sm">Want to learn about trading?</div>
          </div>
        </button>
        {self && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 mt-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Download size={18} /></div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 text-sm">Export your {self.name} data</div>
                <div className="text-xs text-slate-500">Save a file you can import into the full bundle later</div>
              </div>
              <button onClick={() => exportProductData(APP_VARIANT).catch((e) => alert(e.message))}
                className="shrink-0 text-xs font-medium bg-teal-700 text-white rounded-lg px-3 py-2">
                Export
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
    case "businessTeam": return <BusinessTeamScreen ctx={ctx} />;
    case "moveRequests": return <MoveRequestsScreen ctx={ctx} />;
    case "businessSettings": return <BusinessSettingsScreen ctx={ctx} />;
    case "appSettings": return <AppSettingsScreen ctx={ctx} />
    case "reminders": return <RemindersScreen ctx={ctx} />;
    case "theme": return <ThemeScreen ctx={ctx} />;
    case "language": return <LanguageScreen ctx={ctx} />;
    case "quickAccess": return <QuickAccessScreen ctx={ctx} />;
    case "profile": return <ProfileScreen ctx={ctx} />;
    case "about": return <AboutScreen ctx={ctx} />;
    case "switchBusiness": return <SwitchBusinessScreen ctx={ctx} />;
    case "activity": return <ActivityScreen ctx={ctx} bookId={top.bookId} />;
    default: return <BooksScreen ctx={ctx} />;
  }
}

// ---------- Books list ----------
function BooksScreen({ ctx }) {
  const { activeBusiness, push, canManage, getEntries, appSettings, businesses, persistBusinesses, createBusiness, sessionBusinessConfirmed, confirmBusinessSelection, theme, persistTheme, t } = ctx;
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
      if (!activeBusiness) return;
      const entries = {};
      for (const bk of activeBusiness.books) {
        const es = await getEntries(bk.id);
        entries[bk.id] = es.reduce((s, e) => s + (e.type === "in" ? e.amount : -e.amount), 0);
      }
      if (!cancelled) setBalances(entries);
    })();
    return () => { cancelled = true; };
  }, [activeBusiness?.id, activeBusiness?.books.length]);

  const toggleHidden = async (bookId) => {
    const next = businesses.map((b) => b.id === activeBusiness.id
      ? { ...b, books: b.books.map((bk) => bk.id === bookId ? { ...bk, hidden: !bk.hidden } : bk) }
      : b);
    await persistBusinesses(next);
  };

  // First time in the Expenses Manager (no business created yet) — this is where the
  // "what will you manage?" question belongs, not on the app's very first screen.
  if (businesses.length === 0) {
    return (
      <ChooseBusinessType t={ctx.t} onDone={async (managing) => {
        await createBusiness(managing === "personal" ? "My Cashbook" : "My Business");
      }} />
    );
  }

  // Returning user who hasn't confirmed a business yet this session (e.g. just
  // unlocked the app) — show the picker instead of silently continuing in
  // whichever business happened to be active last time. Shown even with just
  // one business, so Expenses Manager always opens on Select Business first.
  if (businesses.length >= 1 && !sessionBusinessConfirmed) {
    return <SwitchBusinessScreen ctx={ctx} embedded onDone={confirmBusinessSelection} />;
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-200 bg-white">
        <button onClick={() => push("switchBusiness")} className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Building2 size={18} /></div>
          <div className="text-left min-w-0">
            <div className="font-semibold text-slate-900 truncate max-w-[180px]">{activeBusiness?.name || t("books.selectBusiness")}</div>
            <div className="text-xs text-slate-500">{t("books.switchBusinessHint")}</div>
          </div>
          <ChevronDown size={16} className="text-slate-400 shrink-0" />
        </button>
        <button onClick={() => push("businessTeam")} className="p-2 text-teal-700"><UserPlus size={20} /></button>
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

        {(!activeBusiness || activeBusiness.books.length === 0) && (
          <EmptyState icon={BookMarked} title={t("books.noBooksTitle")} hint={t("books.noBooksHint")} />
        )}

        <div className="divide-y divide-slate-200 bg-white rounded-xl border border-slate-200">
          {activeBusiness?.books.map((bk) => {
            const net = balances[bk.id] || 0;
            const c = bookCurrency(bk, appSettings);
            return (
              <div key={bk.id} className="w-full flex items-center gap-3 px-4 py-3.5">
                <button onClick={() => push("book", { bookId: bk.id })} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                  <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><BookMarked size={16} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 truncate">{bk.name}</div>
                    <div className="text-xs text-slate-500">{t("books.created", { date: fmtDate(bk.createdAt.slice(0,10)) })}</div>
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
              {BOOK_TEMPLATES.map((tpl) => (
                <Chip key={tpl} onClick={() => addBook(tpl)}>{tpl}</Chip>
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
// more than one business. In that mode there's no screen underneath to
// `pop()` back to, so selecting/creating a business (or dismissing) calls
// `onDone` instead, which just marks the session as confirmed.
function SwitchBusinessScreen({ ctx, embedded, onDone }) {
  const { businesses, session, persistSession, pop, createBusiness, t } = ctx;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const finish = () => { if (embedded) onDone?.(); else pop(); };
  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title={t("switchBusiness.title")} right={<button onClick={finish}><X size={20} className="text-slate-500" /></button>} />
      <div className="p-4 space-y-2 flex-1 overflow-y-auto">
        {embedded && (
          <p className="text-xs text-slate-500 mb-1">
            {businesses.length > 1 ? t("switchBusiness.hintMultiple") : t("switchBusiness.hintSingle")}
          </p>
        )}
        <div className="text-xs font-medium text-slate-400 uppercase mb-1">{t("switchBusiness.yourBusinesses")}</div>
        {businesses.map((b) => (
          <button key={b.id} onClick={async () => { await persistSession({ ...session, activeBusinessId: b.id, viewingAs: null }); finish(); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border ${session.activeBusinessId === b.id ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-white"}`}>
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700"><Building2 size={16} /></div>
            <div className="flex-1 text-left">
              <div className="font-medium text-slate-900">{b.name}</div>
              <div className="text-xs text-slate-500">
                {b.books.length === 1 ? t("switchBusiness.bookCountOne", { count: b.books.length }) : t("switchBusiness.bookCountOther", { count: b.books.length })}
              </div>
            </div>
            {session.activeBusinessId === b.id && <Check size={18} className="text-teal-700" />}
          </button>
        ))}
        {creating ? (
          <div className="flex gap-2 pt-2">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("switchBusiness.businessNamePlaceholder")}
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={async () => { if (name.trim()) { await createBusiness(name.trim()); finish(); } }}
              className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">{t("common.add")}</button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} className="w-full flex items-center justify-center gap-1 bg-teal-700 text-white py-3 rounded-xl font-semibold mt-2">
            <Plus size={18} /> {t("switchBusiness.addNewBusiness")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Book screen ----------
function BookScreen({ ctx, bookId }) {
  const { activeBusiness, businesses, push, pop, getEntries, saveEntries, appSettings, canAddEntries, viewer, logActivity, setBackHandler } = ctx;
  const book = activeBusiness?.books.find((b) => b.id === bookId);
  const [entries, setEntries] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
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

  if (!book) return <EmptyState icon={BookMarked} title="Book not found" />;

  // Move/copy targets span every business the user has, not just the active one —
  // each book is tagged with which business it belongs to so the picker can group
  // them and doMoveOrCopy can find it regardless of which business is "active".
  const otherBooks = (businesses || [])
    .flatMap((biz) => biz.books.map((b) => ({ ...b, businessId: biz.id, businessName: biz.name })))
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
    // Include the source business name in the stamp when the move/copy crosses into a
    // different business, so the entry's transfer history stays legible from either side.
    const crossBusiness = targetBook && targetBook.businessId !== activeBusiness?.id;
    const stamp = {
      transferredFrom: crossBusiness ? `${book?.name} (${activeBusiness?.name})` : book?.name,
      transferredAt: new Date().toISOString(),
    };
    const sourceEntries = await getEntries(bookId);
    const targetEntries = await getEntries(targetBookId);
    const count = selected.length;
    const countLabel = count === 1 ? "an entry" : `${count} entries`;
    if (mode === "move") {
      const nextSource = sourceEntries.filter((e) => !selectedIdSet.has(e.id));
      const moved = sourceEntries.filter((e) => selectedIdSet.has(e.id)).map((e) => ({ ...e, ...stamp }));
      await saveEntries(bookId, nextSource);
      await saveEntries(targetBookId, [...targetEntries, ...moved]);
      await logActivity(bookId, `${viewer.name} moved ${countLabel} to ${targetBook?.name}`);
      await logActivity(targetBookId, `${viewer.name} moved ${countLabel} in from ${book?.name}`);
      setEntries(nextSource);
    } else {
      const copied = sourceEntries.filter((e) => selectedIdSet.has(e.id)).map((e) => ({ ...e, ...stamp, id: uid() }));
      await saveEntries(targetBookId, [...targetEntries, ...copied]);
      await logActivity(bookId, `${viewer.name} copied ${countLabel} to ${targetBook?.name}`);
      await logActivity(targetBookId, `${viewer.name} copied ${countLabel} in from ${book?.name}`);
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
    await logActivity(bookId, `${viewer.name} deleted ${selected.length === 1 ? "an entry" : `${selected.length} entries`}`);
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
      if (typeFilter === "Cash In" && e.type !== "in") return false;
      if (typeFilter === "Cash Out" && e.type !== "out") return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (![e.contact, e.remark, e.category].some((v) => (v || "").toLowerCase().includes(q))) return false;
      }
      return true;
    })
    .slice()
    .reverse(); // newest first for display

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx}
        title={book.name}
        subtitle="Add Member, Book Activity etc"
        onBack={selectMode ? exitSelectMode : pop}
        right={
          selectMode ? (
            <button onClick={exitSelectMode} className="text-sm font-medium text-teal-700 px-2">Cancel</button>
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
            Select All
          </button>
          <span className="text-sm text-slate-600">{selectedIds.size} selected</span>
        </div>
      )}

      <div className="bg-white border-b border-slate-200 px-4 py-3 space-y-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contact, remark, category…"
            className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm" />
        </div>
        <div className="flex gap-2">
          {["All", "Cash In", "Cash Out"].map((t) => (
            <Chip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>{t}</Chip>
          ))}
        </div>
      </div>

      <div className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Net Balance</span>
          <span className={`font-bold text-lg ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{cur}{Math.abs(net).toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm text-slate-500">Total In (+)</span>
          <span className="text-emerald-700 font-medium">{cur}{totalIn.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm text-slate-500">Total Out (-)</span>
          <span className="text-rose-700 font-medium">{cur}{totalOut.toLocaleString()}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-700" size={24} /></div>
        ) : entries.length === 0 ? (
          <EmptyState icon={Wallet} title="No entries yet" hint="Add your first cash in or cash out entry below." />
        ) : visible.length === 0 ? (
          <EmptyState icon={Search} title="No entries match" hint="Try a different search or filter." />
        ) : (
          <div className="divide-y divide-slate-100">
            {visible.map((e) => (
              <EntryRow key={e.id} e={e} cur={cur} balanceText={balanceAfter[e.id].toLocaleString()}
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
            Cancel
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
            <ArrowRightLeft size={18} /> Move / Copy {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
          </button>
        </div>
      ) : canAddEntries && (
        <div className="p-3 border-t border-slate-200 bg-white flex gap-2">
          <button onClick={() => push("addEntry", { bookId, type: "in" })}
            className="flex-1 flex items-center justify-center gap-1 bg-emerald-700 text-white py-2.5 rounded-xl font-semibold">
            <Plus size={18} /> Cash In
          </button>
          <button onClick={() => push("addEntry", { bookId, type: "out" })}
            className="flex-1 flex items-center justify-center gap-1 bg-rose-700 text-white py-2.5 rounded-xl font-semibold">
            <Minus size={18} /> Cash Out
          </button>
        </div>
      )}

      {moveCopyEntries && (
        <MoveCopyModal entries={moveCopyEntries} otherBooks={otherBooks} cur={cur} activeBusinessId={activeBusiness?.id}
          onClose={() => setMoveCopyEntries(null)} onAction={doMoveOrCopy} />
      )}

      {deleteConfirmEntries && (
        <ConfirmModal
          title={deleteConfirmEntries.length === 1 ? "Delete this entry?" : `Delete ${deleteConfirmEntries.length} entries?`}
          message="You won't be able to get this back once it's gone."
          confirmLabel="Yes, Delete" cancelLabel="No"
          onCancel={() => setDeleteConfirmEntries(null)} onConfirm={doDeleteSelected} />
      )}
    </div>
  );
}

function EntryRow({ e, cur, balanceText, selectMode, selected, onTap, onLongPress }) {
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
          {e.remark || e.contact || e.category || (e.type === "in" ? "Cash In" : "Cash Out")}
          {e.receipt && <Paperclip size={12} className="text-slate-400 shrink-0" />}
        </div>
        <div className="text-xs text-slate-500 truncate">{fmtDate(e.date)} · {fmtTime12(e.time)} · {e.paymentMode}{e.addedBy && e.addedBy !== "You" ? ` · by ${e.addedBy}` : ""}</div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-semibold ${e.type === "in" ? "text-emerald-700" : "text-rose-700"}`}>
          {e.type === "in" ? "+" : "-"}{cur}{e.amount.toLocaleString()}
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5">Bal {cur}{balanceText}</div>
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

function MoveCopyModal({ entries, otherBooks, cur, activeBusinessId, onClose, onAction }) {
  const single = entries.length === 1 ? entries[0] : null;
  const totalAmount = entries.reduce((s, e) => s + (e.type === "in" ? e.amount : -e.amount), 0);

  // Group targets by business — current business first (unlabeled, since that's the
  // common case), then every other business under its own header, so it's always clear
  // which business a book belongs to before moving/copying money into it.
  const grouped = [];
  const byBiz = new Map();
  for (const b of otherBooks) {
    if (!byBiz.has(b.businessId)) byBiz.set(b.businessId, []);
    byBiz.get(b.businessId).push(b);
  }
  if (byBiz.has(activeBusinessId)) grouped.push({ businessId: activeBusinessId, businessName: null, books: byBiz.get(activeBusinessId) });
  for (const [businessId, books] of byBiz) {
    if (businessId === activeBusinessId) continue;
    grouped.push({ businessId, businessName: books[0]?.businessName, books });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-t-2xl max-h-[75vh] flex flex-col" onClick={(ev) => ev.stopPropagation()}>
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-slate-900">Move or Copy {single ? "Entry" : `${entries.length} Entries`}</div>
            <button onClick={onClose} className="p-1 text-slate-400"><X size={18} /></button>
          </div>
          <div className="text-sm text-slate-500 mt-1">
            {single
              ? <>{single.type === "in" ? "+" : "-"}{cur}{single.amount.toLocaleString()} · {single.contact || single.category || (single.type === "in" ? "Cash In" : "Cash Out")}</>
              : <>{entries.length} entries selected · net {totalAmount >= 0 ? "+" : "-"}{cur}{Math.abs(totalAmount).toLocaleString()}</>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {otherBooks.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No other books to move or copy into yet.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {grouped.map((g) => (
                <div key={g.businessId}>
                  {g.businessName && (
                    <div className="px-4 pt-3 pb-1 flex items-center gap-1.5 text-xs font-medium text-slate-400 uppercase bg-slate-50">
                      <Building2 size={12} /> {g.businessName}
                    </div>
                  )}
                  {g.books.map((b) => (
                    <div key={b.id} className="flex items-center justify-between px-4 py-3">
                      <div className="font-medium text-slate-800 text-sm">{b.name}</div>
                      <div className="flex gap-2">
                        <button onClick={() => onAction(b.id, "copy")} className="text-xs font-medium border border-teal-700 text-teal-700 rounded-lg px-3 py-1.5">Copy</button>
                        <button onClick={() => onAction(b.id, "move")} className="text-xs font-medium bg-teal-700 text-white rounded-lg px-3 py-1.5">Move</button>
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
  const { pop, push, getEntries, appSettings, activeBusiness, canAddEntries } = ctx;
  const book = activeBusiness?.books.find((b) => b.id === bookId);
  const cur = bookCurrency(book, appSettings);
  const [entry, setEntry] = useState(null);

  useEffect(() => {
    getEntries(bookId).then((es) => setEntry(es.find((e) => e.id === entryId) || null));
  }, [bookId, entryId]);

  if (!entry) {
    return (
      <div className="flex-1 flex flex-col">
        <TopHeader ctx={ctx} title="Entry" onBack={pop} />
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-700" size={24} /></div>
      </div>
    );
  }

  const isIn = entry.type === "in";
  const methodKind = entry.paymentMode === "Cash" ? "Cash" : "Electronic";

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Entry Details" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className={`rounded-xl p-4 text-center ${isIn ? "bg-emerald-50" : "bg-rose-50"}`}>
          <div className={`text-xs font-medium ${isIn ? "text-emerald-800" : "text-rose-800"}`}>{isIn ? "Cash In" : "Cash Out"}</div>
          <div className={`text-2xl font-bold ${isIn ? "text-emerald-800" : "text-rose-800"}`}>{cur}{entry.amount.toLocaleString()}</div>
          <div className="text-xs text-slate-500 mt-1">{methodKind} · {entry.paymentMode}</div>
        </div>

        {entry.receipt && (
          <img src={entry.receipt} alt="Receipt" className="w-full max-h-72 object-contain rounded-xl border border-slate-200 bg-white" />
        )}

        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {entry.contact && (
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">{isIn ? "Received From" : "Paid To"}</span>
              <span className="text-sm font-medium text-slate-800">{entry.contact}</span>
            </div>
          )}
          {entry.category && (
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">Category</span>
              <span className="text-sm font-medium text-slate-800">{entry.category}</span>
            </div>
          )}
          {entry.remark && (
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">Remark</span>
              <span className="text-sm font-medium text-slate-800">{entry.remark}</span>
            </div>
          )}
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-slate-500">Date</span>
            <span className="text-sm font-medium text-slate-800">{fmtDate(entry.date)} · {fmtTime12(entry.time)}</span>
          </div>
        </div>

        {canAddEntries && (
          <button onClick={() => push("addEntry", { bookId, editEntry: entry })}
            className="w-full bg-teal-700 text-white py-2.5 rounded-xl font-semibold">
            Edit Entry
          </button>
        )}

        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          <div className="px-4 py-3">
            <div className="text-xs text-slate-500 mb-0.5">Created by</div>
            <div className="text-sm font-medium text-slate-800">{entry.addedBy || "You"}{entry.createdAt ? ` · ${fmtDateTime(entry.createdAt)}` : ""}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-slate-500 mb-0.5">Last edited by</div>
            <div className="text-sm font-medium text-slate-800">
              {entry.editedBy ? `${entry.editedBy} · ${fmtDateTime(entry.editedAt)}` : "Never edited"}
            </div>
          </div>
          {entry.transferredFrom && (
            <div className="px-4 py-3">
              <div className="text-xs text-slate-500 mb-0.5">Last transferred from</div>
              <div className="text-sm font-medium text-slate-800">{entry.transferredFrom} · {fmtDateTime(entry.transferredAt)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Add / Edit entry ----------
function AddEntryScreen({ ctx, bookId, type, editEntry }) {
  const { pop, getEntries, saveEntries, appSettings, logActivity, viewer, activeBusiness, setBackHandler } = ctx;
  const isEdit = !!editEntry;
  const book = activeBusiness?.books.find((b) => b.id === bookId);
  const bookCur = bookCurrency(book, appSettings);
  const [form, setForm] = useState(() => editEntry
    ? { ...editEntry, time: to24h(editEntry.time) }
    : { type: type || "in", date: todayStr(), time: nowTimeStr24(), amount: "", contact: "", remark: "", category: "", paymentMode: "Cash", receipt: null });
  const [showMoreModes, setShowMoreModes] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      await logActivity(bookId, `${viewer.name} edited an entry (${bookCur}${amt})`);
    } else {
      const payload = { ...form, amount: amt, addedBy: viewer.name };
      next = [...es, { ...payload, id: uid(), createdAt: new Date().toISOString() }];
      await logActivity(bookId, `${viewer.name} added ${form.type === "in" ? "Cash In" : "Cash Out"} of ${bookCur}${amt}`);
    }
    await saveEntries(bookId, next);
    if (addAnother) {
      setForm({ type: form.type, date: form.date, time: nowTimeStr24(), amount: "", contact: "", remark: "", category: "", paymentMode: form.paymentMode, receipt: null });
    } else {
      pop();
    }
  };

  const deleteEntry = async () => {
    const es = await getEntries(bookId);
    await saveEntries(bookId, es.filter((e) => e.id !== editEntry.id));
    await logActivity(bookId, `${viewer.name} deleted an entry`);
    pop();
  };

  const isIn = form.type === "in";
  const modes = appSettings.paymentModes;
  const visibleModes = showMoreModes ? modes : modes.slice(0, 2);

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title={isEdit ? "Edit Entry" : `Add ${isIn ? "Cash In" : "Cash Out"} Entry`} onBack={pop}
        right={isEdit ? <button onClick={() => setConfirmDelete(true)} className="p-2 text-rose-700"><Trash2 size={18} /></button> : null} />
      {confirmDelete && (
        <ConfirmModal title="Delete this entry?" message="You won't be able to get this back once it's gone."
          confirmLabel="Yes, Delete" cancelLabel="No"
          onCancel={() => setConfirmDelete(false)} onConfirm={deleteEntry} />
      )}
      {isEdit && (
        <div className="px-4 pt-3 pb-2 bg-white border-b border-slate-100">
          <div className="text-xs text-slate-500 mb-1.5">Entry Type</div>
          <div className="flex gap-2">
            <button onClick={() => setForm({ ...form, type: "in" })}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-xl font-semibold border ${isIn ? "bg-emerald-700 text-white border-emerald-700" : "border-slate-300 text-slate-500"}`}>
              <Plus size={16} /> Cash In
            </button>
            <button onClick={() => setForm({ ...form, type: "out" })}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-xl font-semibold border ${!isIn ? "bg-rose-700 text-white border-rose-700" : "border-slate-300 text-slate-500"}`}>
              <Minus size={16} /> Cash Out
            </button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex gap-3">
          <label className="flex-1">
            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Calendar size={12} /> Date</div>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="flex-1">
            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Clock size={12} /> Time</div>
            <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
        </div>

        <label className="block">
          <div className="text-xs text-teal-700 mb-1 font-medium">Amount *</div>
          <AmountInput autoFocus value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} currencySymbol={bookCur} />
        </label>

        <label className="block relative">
          <div className="text-xs text-slate-500 mb-1">{isIn ? "Received From" : "Paid To"}</div>
          <input list="contacts-list" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Add name" />
          <datalist id="contacts-list">{contacts.map((c) => <option key={c} value={c} />)}</datalist>
        </label>

        <label className="block">
          <div className="text-xs text-slate-500 mb-1">Remark (Item, Quantity..)</div>
          <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>

        <label className="block">
          <div className="text-xs text-slate-500 mb-1">Category</div>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">Select category</option>
            {appSettings.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <div>
          <div className="text-xs text-slate-500 mb-1.5">Receipt / Photo</div>
          {form.receipt ? (
            <div className="relative inline-block">
              <img src={form.receipt} alt="Receipt" className="h-24 w-24 object-cover rounded-lg border border-slate-200" />
              <button onClick={() => setForm({ ...form, receipt: null })}
                className="absolute -top-2 -right-2 bg-slate-900 text-white rounded-full p-1"><X size={12} /></button>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2 border border-dashed border-slate-300 rounded-lg py-3 text-sm text-slate-500 cursor-pointer">
              <Camera size={16} /> Add a screenshot or photo of receipt
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onReceiptChange} />
            </label>
          )}
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1.5">Payment Mode</div>
          <div className="flex items-center gap-2 flex-wrap">
            {visibleModes.map((m) => (
              <Chip key={m} tone={isIn ? "emerald" : "rose"} active={form.paymentMode === m} onClick={() => setForm({ ...form, paymentMode: m })}>{m}</Chip>
            ))}
            {!showMoreModes && modes.length > 2 && (
              <button onClick={() => setShowMoreModes(true)} className="text-teal-700 text-sm font-medium flex items-center gap-0.5">Show more <ChevronDown size={14} /></button>
            )}
          </div>
        </div>
      </div>
      <div className="p-3 border-t border-slate-200 bg-white flex gap-2">
        {!isEdit && (
          <button onClick={() => save(true)} className="flex-1 border border-teal-700 text-teal-700 py-2.5 rounded-xl font-semibold">Save & Add New</button>
        )}
        <button onClick={() => save(false)} className={`flex-1 text-white py-2.5 rounded-xl font-semibold ${isIn ? "bg-emerald-700" : "bg-rose-700"}`}>Save</button>
      </div>
    </div>
  );
}

// ---------- Book settings ----------
function BookSettingsScreen({ ctx, bookId }) {
  const { activeBusiness, pop, push, persistBusinesses, businesses, canManage, session, persistSession, appSettings } = ctx;
  const book = activeBusiness?.books.find((b) => b.id === bookId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(book?.name || "");
  const [confirmDeleteBook, setConfirmDeleteBook] = useState(false);

  const doRename = async () => {
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, books: b.books.map(bk => bk.id === bookId ? { ...bk, name } : bk) } : b);
    await persistBusinesses(next);
    setRenaming(false);
  };

  const setBookCurrency = async (c) => {
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, books: b.books.map(bk => bk.id === bookId ? { ...bk, currency: c } : bk) } : b);
    await persistBusinesses(next);
  };

  const deleteBook = async () => {
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, books: b.books.filter(bk => bk.id !== bookId) } : b);
    await persistBusinesses(next);
    ctx.resetTo("books");
  };

  const members = activeBusiness?.members || [];

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Book Settings" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 pb-28 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">Cashbook Name</div>
          {renaming ? (
            <div className="flex gap-2">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              <button onClick={doRename} className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">Save</button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-900">{book?.name}</div>
              {canManage && <button onClick={() => setRenaming(true)} className="text-teal-700 text-sm font-medium border border-teal-700 rounded-lg px-3 py-1">Rename</button>}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-2">Book Currency</div>
          <div className="flex gap-2 flex-wrap">
            {Object.keys(CURRENCIES).map((c) => (
              <Chip key={c} active={bookCurrency(book, appSettings) === c} onClick={() => canManage && setBookCurrency(c)}>{c} {CURRENCIES[c]}</Chip>
            ))}
          </div>
          <div className="text-xs text-slate-400 mt-2">This book's amounts display in this currency, independent of other books.</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          <div className="px-4 py-2 text-xs font-medium text-slate-400 uppercase">General Book Settings</div>
          <button onClick={() => push("activity", { bookId })} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700"><Clock size={16} /></div>
            <div className="flex-1"><div className="font-medium text-slate-900">Book Activity</div><div className="text-xs text-slate-500">Stay updated on all book activities</div></div>
            <ChevronRight size={16} className="text-slate-300" />
          </button>
          {canManage && (
            <button onClick={() => push("addMember", { bookId })} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
              <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700"><Users size={16} /></div>
              <div className="flex-1"><div className="font-medium text-slate-900">Manage Members</div><div className="text-xs text-slate-500">Add or edit roles for this book</div></div>
              <ChevronRight size={16} className="text-slate-300" />
            </button>
          )}
        </div>

        {members.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            <div className="px-4 py-2 text-xs font-medium text-slate-400 uppercase">View as (simulate role)</div>
            <button onClick={async () => { await persistSession({ ...session, viewingAs: null }); }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left ${!session.viewingAs ? "bg-teal-50" : ""}`}>
              <div className="w-8 h-8 rounded-full bg-teal-700 text-white flex items-center justify-center text-xs font-semibold">Y</div>
              <div className="flex-1"><div className="font-medium text-slate-900 text-sm">You</div><div className="text-xs text-slate-500">Primary Admin</div></div>
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
            <Trash2 size={16} /> Delete Book
          </button>
        )}
      </div>

      {confirmDeleteBook && (
        <ConfirmModal
          title="Delete this book?"
          message={`This will remove "${book?.name}" and all its entries for good — there's no getting it back after.`}
          confirmLabel="Yes, Delete" cancelLabel="No"
          onCancel={() => setConfirmDeleteBook(false)}
          onConfirm={() => { setConfirmDeleteBook(false); deleteBook(); }} />
      )}
    </div>
  );
}

function ActivityScreen({ ctx, bookId }) {
  const { pop, getActivity } = ctx;
  const [activity, setActivity] = useState(null);
  useEffect(() => { getActivity(bookId).then(setActivity); }, [bookId]);
  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Book Activity" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4">
        {activity === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-700" size={24} /></div>
        ) : activity.length === 0 ? (
          <EmptyState icon={Clock} title="No activity yet" />
        ) : (
          <div className="space-y-3">
            {activity.map((a) => (
              <div key={a.id} className="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
                <div className="text-sm text-slate-800">{a.text}</div>
                <div className="text-xs text-slate-400 mt-0.5">{new Date(a.at).toLocaleString()}</div>
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
  const { activeBusiness, businesses, persistBusinesses, pop, logActivity, viewer } = ctx;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("Data Operator");

  const members = activeBusiness?.members || [];

  const addMember = async () => {
    if (!name.trim()) return;
    const m = { id: uid(), name: name.trim(), phone: phone.trim(), role, status: "pending" };
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, members: [...b.members, m] } : b);
    await persistBusinesses(next);
    await logActivity(bookId, `${viewer.name} invited ${m.name} as ${role}`);
    setName(""); setPhone("");
  };

  const changeRole = async (memberId, newRole) => {
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, members: b.members.map(m => m.id === memberId ? { ...m, role: newRole } : m) } : b);
    await persistBusinesses(next);
  };

  const removeMember = async (memberId) => {
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, members: b.members.filter(m => m.id !== memberId) } : b);
    await persistBusinesses(next);
  };

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Manage Members" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
        <div className="text-xs font-medium text-slate-400 uppercase">Members</div>
        {members.length === 0 && <div className="text-sm text-slate-400">No members added yet.</div>}
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.id} className="bg-white border border-slate-200 rounded-xl px-3 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-semibold">{m.name[0]}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 text-sm">{m.name}</div>
                <div className="text-xs text-slate-500">{m.phone || "No phone"} · {m.status === "pending" ? "Pending" : "Active"}</div>
              </div>
              <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button onClick={() => removeMember(m.id)} className="text-rose-600 p-1"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="font-medium text-slate-800">Add Member</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number (optional)" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-2 flex-wrap">
            {ROLES.map((r) => <Chip key={r} active={role === r} onClick={() => setRole(r)}>{r}</Chip>)}
          </div>
          <button onClick={addMember} disabled={!name.trim()}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold ${name.trim() ? "bg-teal-700 text-white" : "bg-slate-200 text-slate-400"}`}>
            <UserPlus size={16} /> Add Member
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Reports ----------
function ReportsScreen({ ctx, bookId }) {
  const { pop, push, activeBusiness, appSettings } = ctx;
  const book = activeBusiness?.books.find((b) => b.id === bookId);
  const members = activeBusiness?.members || [];
  const [duration, setDuration] = useState("All Time");
  const [entryType, setEntryType] = useState("All");
  const [member, setMember] = useState("All");
  const [cats, setCats] = useState([]);
  const [mode, setMode] = useState("All");
  const [reportType, setReportType] = useState("all");

  const toggleCat = (c) => setCats((cs) => cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c]);

  const filters = { duration, entryType, member, cats, paymentMode: mode, reportType, bookName: book?.name };

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Generate Report" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-sm font-medium text-slate-700">Report will be generated for</div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs text-slate-500 mb-1">Duration</div>
            <select value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white">
              {["All Time", "This Month", "Last 7 Days", "Today"].map(o => <option key={o}>{o}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-slate-500 mb-1">Entry Type</div>
            <select value={entryType} onChange={(e) => setEntryType(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white">
              {["All", "Cash In", "Cash Out"].map(o => <option key={o}>{o}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-slate-500 mb-1">Members</div>
            <select value={member} onChange={(e) => setMember(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white">
              <option>All</option>
              <option>You</option>
              {members.map((m) => <option key={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-slate-500 mb-1">Payment Mode</div>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white">
              <option>All</option>
              {appSettings.paymentModes.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1.5">Categories</div>
          <div className="flex flex-wrap gap-2">
            {appSettings.categories.map((c) => <Chip key={c} active={cats.includes(c)} onClick={() => toggleCat(c)}>{c}</Chip>)}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-slate-700 mb-2">Select Report Type</div>
          <div className="space-y-2">
            {[
              { id: "all", title: "All Entries Report", sub: "List of all entries and details" },
              { id: "category", title: "Category-wise summary", sub: "Income & expenses of all categories" },
              { id: "payment", title: "Payment Mode summary", sub: "Income & expenses of all payment modes" },
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
          <Download size={16} /> Generate Excel
        </button>
        <button onClick={() => push("reportView", { bookId, filters: { ...filters, mode: "pdf" } })}
          className="flex-1 flex items-center justify-center gap-2 bg-teal-700 text-white py-2.5 rounded-xl font-semibold">
          <Printer size={16} /> Generate PDF
        </button>
      </div>
    </div>
  );
}

function applyFilters(entries, f) {
  let list = [...entries];
  const now = new Date();
  if (f.duration === "Today") list = list.filter(e => e.date === todayStr());
  else if (f.duration === "Last 7 Days") {
    const cut = new Date(); cut.setDate(cut.getDate() - 7);
    list = list.filter(e => new Date(e.date) >= cut);
  } else if (f.duration === "This Month") {
    list = list.filter(e => new Date(e.date).getMonth() === now.getMonth() && new Date(e.date).getFullYear() === now.getFullYear());
  }
  if (f.entryType === "Cash In") list = list.filter(e => e.type === "in");
  if (f.entryType === "Cash Out") list = list.filter(e => e.type === "out");
  if (f.member && f.member !== "All") list = list.filter(e => (e.addedBy || "You") === f.member);
  if (f.cats && f.cats.length) list = list.filter(e => f.cats.includes(e.category));
  if (f.paymentMode && f.paymentMode !== "All") list = list.filter(e => e.paymentMode === f.paymentMode);
  return list;
}

function ReportViewScreen({ ctx, bookId, filters }) {
  const { pop, getEntries, appSettings, activeBusiness } = ctx;
  const [entries, setEntries] = useState(null);
  useEffect(() => { getEntries(bookId).then(setEntries); }, [bookId]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    return applyFilters(entries, filters);
  }, [entries, filters]);

  const book = activeBusiness?.books.find((b) => b.id === bookId);
  const cur = bookCurrency(book, appSettings);
  const totalIn = filtered.filter(e => e.type === "in").reduce((s, e) => s + e.amount, 0);
  const totalOut = filtered.filter(e => e.type === "out").reduce((s, e) => s + e.amount, 0);

  const categorySummary = useMemo(() => {
    const map = {};
    filtered.forEach(e => {
      const k = e.category || "Uncategorized";
      if (!map[k]) map[k] = { in: 0, out: 0 };
      map[k][e.type] += e.amount;
    });
    return map;
  }, [filtered]);

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

  const reportSubtitle = `${filters.duration} · ${filters.entryType}${filters.member && filters.member !== "All" ? ` · ${filters.member}` : ""}`;

  const reportTable = () => {
    if (filters.reportType === "all") {
      return {
        headers: ["Date", "Type", "Amount", "Contact/Category"],
        rows: filtered.map(e => [fmtDate(e.date), e.type === "in" ? "Cash In" : "Cash Out", `${cur}${e.amount.toLocaleString()}`, e.contact || e.category || "-"]),
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
      filtered.forEach(e => rows.push([e.date, fmtTime12(e.time), e.type === "in" ? "Cash In" : "Cash Out", e.amount, e.contact, e.category, e.paymentMode, e.remark, e.addedBy || "You"]));
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
      alert("Couldn't export the CSV. Please try again.");
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
      alert("Couldn't create the PDF. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Report" onBack={pop}
        right={<button onClick={downloadPdf} disabled={exporting} className="p-2 text-teal-700 disabled:opacity-40"><Printer size={18} /></button>} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4" id="report-printable">
        <div className="text-center">
          <div className="font-bold text-slate-900">{filters.bookName}</div>
          <div className="text-xs text-slate-500">{filters.duration} · {filters.entryType} {filters.member && filters.member !== "All" ? `· ${filters.member}` : ""}</div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1 bg-emerald-50 rounded-xl p-3 text-center">
            <div className="text-xs text-emerald-800">Total In</div>
            <div className="font-bold text-emerald-800">{cur}{totalIn.toLocaleString()}</div>
          </div>
          <div className="flex-1 bg-rose-50 rounded-xl p-3 text-center">
            <div className="text-xs text-rose-800">Total Out</div>
            <div className="font-bold text-rose-800">{cur}{totalOut.toLocaleString()}</div>
          </div>
        </div>

        {entries === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-700" size={24} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={FileText} title="No entries match these filters" />
        ) : filters.reportType === "all" ? (
          <div className="divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl overflow-hidden">
            {filtered.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
                <div>
                  <div className="font-medium text-slate-800">{e.contact || e.category || "Entry"}</div>
                  <div className="text-xs text-slate-400">{fmtDate(e.date)} · {e.category || "-"} · {e.paymentMode}</div>
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
                <div className="font-medium text-slate-800">{k}</div>
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
                <div className="font-medium text-slate-800">{k}</div>
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
            {exporting ? "Preparing…" : "Download CSV"}
          </button>
        ) : (
          <button onClick={downloadPdf} disabled={exporting}
            className="w-full flex items-center justify-center gap-2 bg-teal-700 text-white py-2.5 rounded-xl font-semibold disabled:opacity-50">
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
            {exporting ? "Preparing…" : "Print / Save as PDF"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Charts ----------
function ChartsScreen({ ctx, bookId }) {
  const { pop, getEntries, appSettings, activeBusiness } = ctx;
  const book = activeBusiness?.books.find((b) => b.id === bookId);
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
        ? (e.category || "Uncategorized")
        : new Date(e.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });
      map[key] = (map[key] || 0) + e.amount;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [entries, groupBy]);

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Expense Breakdown" subtitle={book?.name} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex gap-2">
          <Chip active={groupBy === "category"} tone="rose" onClick={() => setGroupBy("category")}>By Category</Chip>
          <Chip active={groupBy === "month"} tone="rose" onClick={() => setGroupBy("month")}>By Month</Chip>
        </div>

        <div className="bg-rose-50 rounded-xl p-3 text-center">
          <div className="text-xs text-rose-800">Total Expenses</div>
          <div className="font-bold text-rose-800 text-lg">{cur}{totalExpense.toLocaleString()}</div>
        </div>

        {entries === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-700" size={24} /></div>
        ) : data.length === 0 ? (
          <EmptyState icon={PieChartIcon} title="No expenses yet" hint="Add a Cash Out entry to see the breakdown here." />
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
const THEME_OPTIONS = [
  { id: "light", label: "Light", sub: "The default look", swatches: ["#f8fafc", "#0f766e", "#b45309"], group: "Solid" },
  { id: "dark", label: "Dark", sub: "Easier on the eyes at night", swatches: ["#0f172a", "#14b8a6", "#f59e0b"], group: "Solid" },
  { id: "brown-cream", label: "Brown & Cream", sub: "Warm, earthy tones", swatches: ["#f5ede1", "#7c4a25", "#a86b2d"], group: "Solid" },
  { id: "pink", label: "Pink", sub: "Soft pastel rose", swatches: ["#fef7fa", "#d6598e", "#e17ba6"], group: "Solid" },
  { id: "islamic", label: "Green & Gold", sub: "Rich green and gold tones", swatches: ["#f4f8f4", "#0f6b3f", "#b8860b"], group: "Solid" },
  { id: "minimalist", label: "Minimalist", sub: "Clean, modern & monochrome", swatches: ["#fafafa", "#2563eb", "#18181b"], group: "Solid" },
  { id: "light-dots", label: "Light Dots", sub: "Light theme with a soft dot grid", swatches: ["#f8fafc", "#0f766e", "#b45309"], group: "Pattern" },
  { id: "dark-grid", label: "Dark Grid", sub: "Dark theme with a fine line grid", swatches: ["#0f172a", "#14b8a6", "#f59e0b"], group: "Pattern" },
  { id: "terracotta-waves", label: "Terracotta Waves", sub: "Warm terracotta with a diagonal weave", swatches: ["#fdf6ee", "#c2410c", "#9a3412"], group: "Pattern" },
  { id: "holiday-newyear", label: "New Year", sub: "Midnight blue & gold sparkle", swatches: ["#0b1f3a", "#d4af37", "#14355e"], group: "Holiday" },
  { id: "holiday-genna", label: "Genna", sub: "Ethiopian Christmas — deep red & gold", swatches: ["#fdf6ec", "#7a1f2b", "#b8860b"], group: "Holiday" },
  { id: "holiday-timkat", label: "Timkat", sub: "Epiphany — sky blue ripples", swatches: ["#eef7fb", "#0369a1", "#b8860b"], group: "Holiday" },
  { id: "holiday-eid", label: "Eid", sub: "Green & gold, fine mesh", swatches: ["#f3f9f4", "#0a5c33", "#b8860b"], group: "Holiday" },
  { id: "holiday-enkutatash", label: "Enkutatash", sub: "Ethiopian New Year — Adey Abeba yellow & green", swatches: ["#f6faf0", "#4d7c0f", "#ca8a04"], group: "Holiday" },
  { id: "holiday-meskel", label: "Meskel", sub: "Meskel flower purple & gold", swatches: ["#f7f3fa", "#6b21a8", "#ca8a04"], group: "Holiday" },
  { id: "holiday-christmas", label: "Christmas", sub: "Red, green & a dusting of snow", swatches: ["#fdf5f5", "#b91c1c", "#15803d"], group: "Holiday" },
];
const THEME_GROUP_ORDER = ["Solid", "Pattern", "Holiday"];

function ThemeScreen({ ctx }) {
  const { pop, theme, persistTheme, t } = ctx;
  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title={t("theme.title")} subtitle={t("theme.subtitle")} onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {THEME_GROUP_ORDER.map((group) => (
          <div key={group}>
            <div className="text-xs font-medium text-slate-400 uppercase mb-2 px-1">{group}</div>
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
                      <div className="font-medium text-slate-900 text-sm">{opt.label}</div>
                      <div className="text-xs text-slate-500">{opt.sub}</div>
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
  const { pop, language, persistLanguage, t } = ctx;
  return (
    <div className="flex-1 flex flex-col">
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
      </div>
    </div>
  );
}

// ---------- Quick Access (home screen widget / floating icon) ----------
function QuickAccessScreen({ ctx }) {
  const { pop } = ctx;
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
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Quick Access" subtitle="Reach Expenses Manager without opening the app first" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!native && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            These options only work on an installed Android build, not in this browser preview.
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><LayoutGrid size={18} /></div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-900">Home screen widget</div>
              <div className="text-xs text-slate-500 mt-0.5">
                A small tile on your home screen showing your net balance across every business —
                tap it any time to jump straight into the app.
              </div>
            </div>
          </div>
          {widgetSupported ? (
            <button onClick={addWidget} disabled={!native || busy}
              className="w-full mt-3 bg-teal-700 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
              Add widget to Home screen
            </button>
          ) : (
            <div className="text-xs text-slate-500 mt-3">
              Your device doesn't support adding widgets from inside the app — instead, long-press an
              empty spot on your home screen, choose Widgets, and find "TallyBook".
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Move size={18} /></div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-900">Floating icon</div>
              <div className="text-xs text-slate-500 mt-0.5">
                A small draggable bubble that floats over other apps — tap it to open TallyBook instantly.
                Requires the "display over other apps" permission, granted once from system Settings.
              </div>
            </div>
            <button onClick={toggleBubble} disabled={!native || busy}
              className={`shrink-0 w-11 h-6 rounded-full relative transition-colors ${bubbleOn ? "bg-teal-700" : "bg-slate-200"} disabled:opacity-50`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${bubbleOn ? "left-5" : "left-0.5"}`} />
            </button>
          </div>
          {native && !overlayGranted && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mt-3">
              Tapping the toggle will open your device's Settings to grant "display over other apps" —
              come back here and tap it again once it's allowed.
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
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title={t("settings.title")} />
      <div className="flex-1 overflow-y-auto">
        {(IS_BUNDLE || APP_VARIANT === "expenses-manager") && (
          <div className="divide-y divide-slate-100 bg-white">
            <Item icon={Users} title={t("settings.businessTeamTitle")} sub={t("settings.businessTeamSub")} onClick={() => push("businessTeam")} />
            <Item icon={ArrowRightLeft} title={t("settings.moveRequestsTitle")} sub={t("settings.moveRequestsSub")} onClick={() => push("moveRequests")} />
            <Item icon={Building2} title={t("settings.businessSettingsTitle")} sub={t("settings.businessSettingsSub")} onClick={() => push("businessSettings")} />
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
          <Item icon={Info} title={t("settings.aboutTitle")} sub={t("settings.aboutSub")} onClick={() => push("about")} />
        </div>
      </div>
    </div>
  );
}

function BusinessTeamScreen({ ctx }) {
  const { activeBusiness, businesses, persistBusinesses, pop } = ctx;
  const members = activeBusiness?.members || [];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("Data Operator");

  const addMember = async () => {
    if (!name.trim() || !activeBusiness) return;
    const m = { id: uid(), name: name.trim(), phone: phone.trim(), role, status: "pending" };
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, members: [...b.members, m] } : b);
    await persistBusinesses(next);
    setName(""); setPhone(""); setRole("Data Operator"); setAdding(false);
  };

  const removeMember = async (memberId) => {
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, members: b.members.filter(m => m.id !== memberId) } : b);
    await persistBusinesses(next);
  };

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Business Team" onBack={pop}
        right={<button onClick={() => setAdding((v) => !v)} className="p-2 text-teal-700"><UserPlus size={18} /></button>} />
      <div className="flex-1 overflow-y-auto p-4 space-y-2 pb-28">
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-teal-700 text-white flex items-center justify-center font-semibold">Y</div>
          <div className="flex-1"><div className="font-medium text-slate-900 text-sm">You</div><div className="text-xs text-slate-500">Primary Admin</div></div>
          <ShieldCheck size={16} className="text-teal-700" />
        </div>

        {adding && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="font-medium text-slate-800">Add Member</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number (optional)" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <div className="flex gap-2 flex-wrap">
              {ROLES.map((r) => <Chip key={r} active={role === r} onClick={() => setRole(r)}>{r}</Chip>)}
            </div>
            <button onClick={addMember} disabled={!name.trim()}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold ${name.trim() ? "bg-teal-700 text-white" : "bg-slate-200 text-slate-400"}`}>
              <UserPlus size={16} /> Add Member
            </button>
          </div>
        )}

        {members.length === 0 && !adding ? (
          <EmptyState icon={Users} title="No team members yet" hint="Tap the person-add icon above to invite someone to this business." />
        ) : members.map((m) => (
          <div key={m.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-300 text-white flex items-center justify-center font-semibold">{m.name[0]}</div>
            <div className="flex-1"><div className="font-medium text-slate-900 text-sm">{m.name}</div><div className="text-xs text-slate-500">{m.role} · {m.status === "pending" ? "Pending" : "Active"}</div></div>
            <button onClick={() => removeMember(m.id)} className="text-rose-600 p-1"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MoveRequestsScreen({ ctx }) {
  const { activeBusiness, businesses, persistBusinesses, pop, getEntries, saveEntries, logActivity } = ctx;
  const requests = (activeBusiness?.moveRequests || []);

  const respond = async (reqId, approve) => {
    const req = requests.find(r => r.id === reqId);
    if (!req) return;
    const isCopy = req.mode === "copy";

    if (approve) {
      const fromBiz = businesses.find(b => b.id === req.fromBusinessId);
      const sourceBook = fromBiz?.books.find(bk => bk.id === req.bookId);
      if (sourceBook) {
        if (isCopy) {
          // Copy: source business keeps its book untouched; target gets an
          // independent book (new id) with its own duplicated entries, so
          // editing one copy never affects the other.
          const newBook = { ...sourceBook, id: uid(), createdAt: new Date().toISOString() };
          const sourceEntries = await getEntries(req.bookId);
          await saveEntries(newBook.id, sourceEntries.map(e => ({ ...e })));
          await logActivity(newBook.id, `Copied from "${req.fromBusinessName}"`);
          const next = businesses.map((b) => b.id === activeBusiness.id
            ? { ...b, books: [...b.books, newBook], moveRequests: b.moveRequests.filter(r => r.id !== reqId) }
            : b);
          await persistBusinesses(next);
        } else {
          // Move: book (and its entries, unmodified under the same id) leaves
          // the source business entirely and exists only in the target.
          const next = businesses.map((b) => {
            if (b.id === req.fromBusinessId) return { ...b, books: b.books.filter(bk => bk.id !== req.bookId) };
            if (b.id === activeBusiness.id) return { ...b, books: [...b.books, sourceBook], moveRequests: b.moveRequests.filter(r => r.id !== reqId) };
            return b;
          });
          await persistBusinesses(next);
        }
      }
    } else {
      const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, moveRequests: b.moveRequests.filter(r => r.id !== reqId) } : b);
      await persistBusinesses(next);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Move & Copy Book Requests" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {requests.length === 0 ? (
          <EmptyState icon={Inbox} title="No pending requests" hint="Requests to move or copy a book into this business will appear here." />
        ) : requests.map((r) => (
          <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="font-medium text-slate-900 text-sm">{r.bookName}</div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${r.mode === "copy" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>
                {r.mode === "copy" ? "COPY" : "MOVE"}
              </span>
            </div>
            <div className="text-xs text-slate-500 mb-3">
              From {r.fromBusinessName}{r.mode === "copy" ? " — a copy will be added here; the original stays there too." : " — it will no longer be in that business once approved."}
            </div>
            <div className="flex gap-2">
              <button onClick={() => respond(r.id, true)} className="flex-1 bg-teal-700 text-white py-2 rounded-lg text-sm font-medium">Approve</button>
              <button onClick={() => respond(r.id, false)} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded-lg text-sm font-medium">Deny</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BusinessSettingsScreen({ ctx }) {
  const { activeBusiness, businesses, persistBusinesses, pop, session, resetTo } = ctx;
  const [name, setName] = useState(activeBusiness?.name || "");
  const [moveTarget, setMoveTarget] = useState("");
  const [moveBook, setMoveBook] = useState("");
  const [moveMode, setMoveMode] = useState("move"); // "move" | "copy"
  const [confirmDeleteBusiness, setConfirmDeleteBusiness] = useState(false);

  const rename = async () => {
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, name } : b);
    await persistBusinesses(next);
  };

  const requestMove = async () => {
    if (!moveTarget || !moveBook) return;
    const book = activeBusiness.books.find(b => b.id === moveBook);
    const req = { id: uid(), bookId: moveBook, bookName: book.name, fromBusinessId: activeBusiness.id, fromBusinessName: activeBusiness.name, mode: moveMode };
    const next = businesses.map((b) => b.id === moveTarget ? { ...b, moveRequests: [...(b.moveRequests || []), req] } : b);
    await persistBusinesses(next);
    setMoveBook(""); setMoveTarget(""); setMoveMode("move");
  };

  const deleteBusiness = async () => {
    const next = businesses.filter((b) => b.id !== activeBusiness.id);
    await persistBusinesses(next);
    resetTo("books");
  };

  const bookCount = activeBusiness?.books?.length || 0;
  const deleteBusinessMessage = bookCount > 0
    ? `This will remove "${activeBusiness.name}" and its ${bookCount} book${bookCount === 1 ? "" : "s"} for good — there's no getting it back after.`
    : `This will remove "${activeBusiness?.name}" for good — there's no getting it back after.`;

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Business Settings" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">Business Name</div>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={rename} className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">Save</button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="font-medium text-slate-800 flex items-center gap-2"><ArrowRightLeft size={16} className="text-teal-700" /> Move or copy a book to another business</div>
          {businesses.length <= 1 ? (
            <div className="text-xs text-slate-500">Add another business first — you'll need somewhere to move or copy a book into.</div>
          ) : activeBusiness.books.length === 0 ? (
            <div className="text-xs text-slate-500">This business has no books yet to move or copy.</div>
          ) : (
            <>
              <div className="flex gap-2">
                <button type="button" onClick={() => setMoveMode("move")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${moveMode === "move" ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-600 border-slate-300"}`}>
                  Move
                </button>
                <button type="button" onClick={() => setMoveMode("copy")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${moveMode === "copy" ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-600 border-slate-300"}`}>
                  Copy
                </button>
              </div>
              <div className="text-xs text-slate-500">
                {moveMode === "copy"
                  ? "Copy: the book will exist in both businesses as two independent copies — one here, one there."
                  : "Move: the book leaves this business and exists only in the target business once approved."}
              </div>
              <select value={moveBook} onChange={(e) => setMoveBook(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Select book</option>
                {activeBusiness.books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Select target business</option>
                {businesses.filter(b => b.id !== activeBusiness.id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button onClick={requestMove} disabled={!moveTarget || !moveBook}
                className={`w-full py-2.5 rounded-xl font-semibold text-sm ${(!moveTarget || !moveBook) ? "bg-slate-200 text-slate-400" : "bg-teal-700 text-white"}`}>
                Send {moveMode === "copy" ? "Copy" : "Move"} Request
              </button>
            </>
          )}
        </div>

        <button onClick={() => setConfirmDeleteBusiness(true)} className="w-full flex items-center justify-center gap-2 text-rose-700 border border-rose-200 rounded-xl py-3 font-medium">
          <Trash2 size={16} /> Delete Business
        </button>
      </div>

      {confirmDeleteBusiness && (
        <ConfirmModal
          title="Delete this business?"
          message={deleteBusinessMessage}
          confirmLabel="Yes, Delete" cancelLabel="No"
          onCancel={() => setConfirmDeleteBusiness(false)}
          onConfirm={() => { setConfirmDeleteBusiness(false); deleteBusiness(); }} />
      )}
    </div>
  );
}

function AppSettingsScreen({ ctx }) {
  const { appSettings, persistSettings, pop } = ctx;
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
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="App Settings" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="font-medium text-slate-800 mb-2">Currency</div>
          <div className="flex gap-2 flex-wrap">
            {Object.keys(CURRENCIES).map((c) => (
              <Chip key={c} active={appSettings.currency === c} onClick={() => persistSettings({ ...appSettings, currency: c })}>{c} {CURRENCIES[c]}</Chip>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="font-medium text-slate-800 mb-2">Categories</div>
          <div className="flex flex-wrap gap-2 mb-3">
            {appSettings.categories.map((c) => (
              <span key={c} className="flex items-center gap-1 bg-slate-100 rounded-full pl-3 pr-1 py-1 text-sm text-slate-700">
                {c} <button onClick={() => removeCat(c)} className="p-1 text-slate-400"><X size={12} /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category" className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={addCat} className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">Add</button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="font-medium text-slate-800 mb-2">Payment Modes</div>
          <div className="flex flex-wrap gap-2 mb-3">
            {appSettings.paymentModes.map((m) => (
              <span key={m} className="flex items-center gap-1 bg-slate-100 rounded-full pl-3 pr-1 py-1 text-sm text-slate-700">
                {m} <button onClick={() => removeMode(m)} className="p-1 text-slate-400"><X size={12} /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newMode} onChange={(e) => setNewMode(e.target.value)} placeholder="New payment mode" className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={addMode} className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RemindersScreen({ ctx }) {
  const { pop, plannedItems, persistPlanned, appSettings, notifPermission, requestNotifPermission } = ctx;
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
      alert("Notifications weren't allowed. You can still set reminder times, but you won't get a native alert — allow notifications from your phone's app settings to enable them.");
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Reminders" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0">
            {notifPermission === "granted" ? <BellRing size={16} /> : <BellOff size={16} />}
          </div>
          <div className="flex-1">
            <div className="font-medium text-slate-800 text-sm">Notifications</div>
            <div className="text-xs text-slate-500">
              {notifPermission === "granted" ? "Allowed on this device" : "Allow notifications to get native alerts at the time you pick"}
            </div>
          </div>
          {notifPermission !== "granted" && (
            <button onClick={onAllow} className="text-xs font-medium text-teal-700 border border-teal-200 rounded-lg px-3 py-1.5 shrink-0">Allow</button>
          )}
        </div>

        <p className="text-xs text-slate-500 px-1">
          Set a date and time for any pending item on your "to buy / to pay for" list, and TallyBook will remind you.
        </p>

        {pending.length === 0 ? (
          <EmptyState icon={Bell} title="Nothing to remind you about" hint='Add items from the list icon that floats on any screen, then come back here to set reminders.' />
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-3.5">
                <div className="font-medium text-slate-900 text-sm mb-0.5">{p.desc}</div>
                <div className="text-xs text-slate-500 mb-2">{p.category} · {appSettings.currency}{Number(p.amount || 0).toLocaleString()}</div>
                <div className="flex gap-2">
                  <input
                    type="datetime-local"
                    defaultValue={p.reminderAt ? p.reminderAt.slice(0, 16) : ""}
                    onChange={(e) => setReminder(p.id, e.target.value ? new Date(e.target.value).toISOString() : null)}
                    className="flex-1 min-w-0 border border-slate-300 rounded-lg px-2.5 py-2 text-sm"
                  />
                  {p.reminderAt && (
                    <button onClick={() => setReminder(p.id, null)} className="text-xs text-rose-600 border border-rose-200 rounded-lg px-2.5 shrink-0">Clear</button>
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
  const { pop } = ctx;
  const [profile, setProfile] = useState({ name: "", mobile: "", email: "" });
  useEffect(() => { storeGet("profile", { name: "", mobile: "", email: "" }).then(setProfile); }, []);
  const save = async (next) => { setProfile(next); await storeSet("profile", next); };
  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Your Profile" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <label className="block">
          <div className="text-xs text-slate-500 mb-1">Name</div>
          <input value={profile.name} onChange={(e) => save({ ...profile, name: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <div className="text-xs text-slate-500 mb-1">Mobile Number</div>
          <input value={profile.mobile} onChange={(e) => save({ ...profile, mobile: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <div className="text-xs text-slate-500 mb-1">Email</div>
          <input value={profile.email} onChange={(e) => save({ ...profile, email: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
      </div>
    </div>
  );
}

function AboutScreen({ ctx }) {
  const { pop } = ctx;
  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="About በጅሮንድ" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm text-slate-600">
        <p>በጅሮንድ is a simple ledger for tracking cash in and cash out across businesses and books, with lightweight team roles and exportable reports.</p>
        <p>All your data is stored privately and stays on your account only.</p>
        <p className="text-xs text-slate-400 pt-4">Version 1.0.0 · Demo build</p>
      </div>
    </div>
  );
}

function HelpScreen({ ctx }) {
  return (
    <div className="flex-1 flex flex-col">
      <TopHeader ctx={ctx} title="Help" />
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {[
          ["How do I add a cash entry?", "Open a book, tap Cash In or Cash Out, fill in the amount and details, then Save."],
          ["How do I invite a team member?", "Open a book → the person-add icon in the header → Add Member, then set their role."],
          ["What do the roles mean?", "Book Admin: full control. Data Operator: can add entries. Viewer: read-only."],
          ["How do I export a report?", "Open a book → the report icon → choose filters and Generate Excel or PDF."],
          ["How do I search or filter entries?", "Open a book and tap the search icon in the header — filter by Cash In/Out or search contact, remark, and category."],
          ["Where's the expense breakdown chart?", "Open a book → the pie chart icon in the header — switch between by category and by month."],
          ["Can each book use a different currency?", "Yes — open a book → the menu icon → Book Settings, and pick a currency just for that book."],
          ["Can I hide a book's balance?", "On the books list, tap the eye icon next to any book to hide or show its balance."],
        ].map(([q, a]) => (
          <div key={q} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="font-medium text-slate-900 text-sm mb-1">{q}</div>
            <div className="text-sm text-slate-500">{a}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
