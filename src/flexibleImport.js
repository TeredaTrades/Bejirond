// ---------- flexible CSV import (partial / hand-made spreadsheets) ----------
// parseEntriesCsv in App.jsx is a strict, lossless round trip: it only
// accepts the exact 9-column header this app itself writes. That's the
// right default for app-to-app transfers, but it rejects anything a person
// built by hand in a spreadsheet — a single "Amount" column, three columns
// in a different order, no header row at all, dates typed as "15/01/2024"
// instead of this app's stored ISO format, and so on.
//
// This module is the fallback for exactly that case. It never claims to be
// lossless — it's a best-effort recovery, in the same spirit as
// pdfImport.js's PDF recovery — and it always fills in every field the app
// needs (date, type, payment mode) even when the source file didn't have
// that information, defaulting sensibly and reporting how many rows needed
// a default so the UI can be honest about it.
//
// Two recognition passes, tried in order:
//   1. Header aliasing — if the first row's cells match known names for
//      any of the 9 fields (in any order, any subset), use that mapping.
//      This covers "the person renamed/reordered/dropped columns but kept
//      a header row".
//   2. Content sniffing — if no header row is recognized, guess each
//      column's meaning from the shape of its data (amount-shaped numbers,
//      date-shaped strings, "in"/"out"-shaped words, known payment mode
//      names). This covers "no header row at all".
// Whichever columns still can't be identified are left unassigned rather
// than guessed at random.

const FIELD_ALIASES = {
  date: ["date", "transaction date", "entry date", "day"],
  time: ["time", "hour", "clock"],
  type: ["type", "direction", "in/out", "cash in/out", "transaction type", "flow"],
  amount: ["amount", "amt", "value", "total", "sum", "price"],
  contact: ["contact", "party", "customer", "vendor", "payee", "person", "name"],
  category: ["category", "cat", "tag", "classification", "expense type"],
  paymentMode: ["payment mode", "mode", "payment method", "method", "via", "payment"],
  remark: ["remark", "remarks", "note", "notes", "description", "memo", "comment"],
  addedBy: ["added by", "by", "added", "user", "recorded by", "entered by"],
};

const COMMON_PAYMENT_MODES = [
  "cash", "bank", "bank transfer", "card", "cheque", "check", "online",
  "upi", "paypal", "wallet", "mobile money", "telebirr", "cbe birr",
  "coopay", "m-pesa", "mpesa",
];

const IN_WORDS = new Set(["in", "cash in", "credit", "income", "deposit", "received", "cr", "inflow"]);
const OUT_WORDS = new Set(["out", "cash out", "debit", "expense", "withdrawal", "paid", "dr", "outflow"]);

// ---------- small standalone CSV cell parser (RFC4180-ish) ----------
// Deliberately duplicated from App.jsx's parseCsv rather than imported —
// this module has to also cope with files this app never wrote (no
// guaranteed quoting style), and keeping it self-contained avoids coupling
// two independent recovery paths together.
function parseCsvRows(text) {
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

function normalizeDigits(str) {
  return str
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

// ---------- per-cell shape detectors ----------
// Deliberately strict (whole-cell match) rather than "contains a number
// somewhere" — that's what lets amount, date, and type stay distinguishable
// from each other when sniffing a column with no header to go on.
function looksLikeAmount(raw) {
  const s = normalizeDigits(String(raw ?? "").trim());
  if (!s) return false;
  return /^[+-]?(?:[a-zA-Z]{1,3}\.?\s?|[^\w\s][\s]?)?[0-9][0-9.,\s]*$/u.test(s);
}
function parseAmountLoose(raw) {
  if (!looksLikeAmount(raw)) return null;
  const s = normalizeDigits(String(raw).trim());
  const neg = /^-/.test(s.trim()) || /^[a-zA-Z]{1,3}\.?\s?-/.test(s.trim());
  const m = s.match(/[0-9][0-9.,\s]*[0-9]|[0-9]/);
  if (!m) return null;
  let numStr = m[0].replace(/\s/g, "");
  const lastSep = Math.max(numStr.lastIndexOf(","), numStr.lastIndexOf("."));
  const fracLen = numStr.length - lastSep - 1;
  if (lastSep !== -1 && fracLen >= 1 && fracLen <= 2) {
    numStr = `${numStr.slice(0, lastSep).replace(/[.,]/g, "")}.${numStr.slice(lastSep + 1)}`;
  } else {
    numStr = numStr.replace(/[.,]/g, "");
  }
  const n = Number(numStr);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const MONTHS_RE = /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i;
function looksLikeDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) return true;
  if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(s)) return true;
  if (MONTHS_RE.test(s) && /\d/.test(s)) return true;
  return false;
}
// Returns an ISO yyyy-mm-dd string, or null. Numeric d/m/y-style dates are
// ambiguous without a header to say which part is which — day-first is
// assumed when both readings are plausible, since this app's audience skews
// international rather than US-only; when one reading is implausible
// (a part >12), the unambiguous reading wins regardless of position.
function parseDateLoose(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, a, b, year] = m;
    a = Number(a); b = Number(b);
    if (year.length === 2) year = Number(year) < 70 ? `20${year}` : `19${year}`;
    let day, month;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { day = b; month = a; }
    else { day = a; month = b; } // ambiguous — default to day-first
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (MONTHS_RE.test(s) && /\d/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function looksLikeType(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return IN_WORDS.has(s) || OUT_WORDS.has(s);
}
function parseTypeLoose(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (IN_WORDS.has(s)) return "in";
  if (OUT_WORDS.has(s)) return "out";
  return null;
}

function looksLikePaymentMode(raw, knownModes) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return false;
  if (knownModes.some((m) => m.toLowerCase() === s)) return true;
  return COMMON_PAYMENT_MODES.includes(s);
}

// ---------- header aliasing ----------
function matchHeaderField(cell) {
  const s = String(cell ?? "").trim().toLowerCase();
  if (!s) return null;
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(s)) return field;
  }
  return null;
}
function detectHeaderMapping(headerRow) {
  const mapping = {};
  const claimed = new Set();
  headerRow.forEach((cell, i) => {
    const f = matchHeaderField(cell);
    if (f && !claimed.has(f)) { mapping[i] = f; claimed.add(f); }
  });
  return { mapping, matches: claimed.size };
}

// ---------- content sniffing ----------
// Amount is claimed first (it's the one field every row in this feature
// needs), then date/type/payment mode, each only if a clear majority of its
// non-empty cells match that shape. Whatever's left over is assigned, in
// order, to contact / category / remark — those are free text with no
// reliable shape to detect, so position among the leftovers is the only
// signal available.
function sniffColumnTypes(rows, knownModes) {
  const numCols = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const mapping = {};
  const used = new Set();
  const scoreCol = (i, test) => {
    let hits = 0, total = 0;
    for (const r of rows) {
      const v = r[i];
      if (v === undefined || String(v).trim() === "") continue;
      total++;
      if (test(v)) hits++;
    }
    return total === 0 ? 0 : hits / total;
  };
  const shapeTests = [
    ["amount", (v) => looksLikeAmount(v)],
    ["date", (v) => looksLikeDate(v)],
    ["type", (v) => looksLikeType(v)],
    ["paymentMode", (v) => looksLikePaymentMode(v, knownModes)],
  ];
  for (const [field, test] of shapeTests) {
    let best = -1, bestScore = 0.6; // require a clear majority before claiming a column
    for (let i = 0; i < numCols; i++) {
      if (used.has(i)) continue;
      const score = scoreCol(i, test);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best !== -1) { mapping[best] = field; used.add(best); }
  }
  const leftoverOrder = ["contact", "category", "remark"];
  let li = 0;
  for (let i = 0; i < numCols && li < leftoverOrder.length; i++) {
    if (used.has(i)) continue;
    mapping[i] = leftoverOrder[li++];
    used.add(i);
  }
  return mapping;
}

// A shape-mapped column whose first row breaks that shape (while later rows
// hold it) is a strong sign row 0 is a header written in words the alias
// list doesn't know — drop it and re-sniff on the remaining rows so that
// header text can't skew the amount/date detection.
function firstRowIsUnrecognizedHeader(rows, mapping) {
  if (rows.length < 2) return false;
  const first = rows[0];
  const testers = { amount: looksLikeAmount, date: looksLikeDate, type: looksLikeType };
  let checked = 0, mismatches = 0;
  for (const [idxStr, field] of Object.entries(mapping)) {
    const test = testers[field];
    if (!test) continue;
    const v = first[Number(idxStr)];
    if (v === undefined || String(v).trim() === "") continue;
    checked++;
    if (!test(v)) mismatches++;
  }
  return checked > 0 && mismatches === checked;
}

function colFor(mapping, field) {
  const idx = Object.keys(mapping).find((k) => mapping[k] === field);
  return idx === undefined ? null : Number(idx);
}
function cellFor(row, mapping, field) {
  const idx = colFor(mapping, field);
  return idx === null ? undefined : row[idx];
}

// Reads CSV text with any subset/order/absence of the 9 fields and returns
// { entries, error, guessed }.
// - entries: recovered rows (same shape App.jsx's own entries use).
// - error: a translated message if nothing usable (no amount-shaped column
//   found at all) could be identified.
// - guessed: count of entries where a required field (date or type) had no
//   data to recover and was defaulted instead — so the UI can say so.
export function parseEntriesCsvFlexible(text, t, { uid, knownPaymentModes = [] } = {}) {
  const rows = parseCsvRows(String(text ?? "").replace(/^\uFEFF/, ""))
    .filter((r) => !(r.length === 1 && r[0].trim() === ""));
  if (rows.length === 0) return { entries: [], error: t("bookSettings.importCsvErrorEmpty"), guessed: 0 };

  const { mapping: headerMapping, matches } = detectHeaderMapping(rows[0]);
  let mapping, dataRows;
  if (matches > 0) {
    mapping = headerMapping;
    dataRows = rows.slice(1);
  } else {
    mapping = sniffColumnTypes(rows, knownPaymentModes);
    if (firstRowIsUnrecognizedHeader(rows, mapping)) {
      dataRows = rows.slice(1);
      mapping = sniffColumnTypes(dataRows, knownPaymentModes);
    } else {
      dataRows = rows;
    }
  }

  if (colFor(mapping, "amount") === null) {
    return { entries: [], error: t("bookSettings.importCsvErrorFormat"), guessed: 0 };
  }

  const entries = [];
  let guessed = 0;
  const todayIso = new Date().toISOString().slice(0, 10);
  for (const r of dataRows) {
    if (r.every((c) => String(c ?? "").trim() === "")) continue;
    const amountSigned = parseAmountLoose(cellFor(r, mapping, "amount"));
    if (amountSigned === null || amountSigned === 0) continue; // nothing to anchor an entry on

    let rowGuessed = false;

    const dateRaw = cellFor(r, mapping, "date");
    const date = (dateRaw && parseDateLoose(dateRaw)) || (rowGuessed = true, todayIso);

    const typeRaw = cellFor(r, mapping, "type");
    const type = (typeRaw && parseTypeLoose(typeRaw))
      || (rowGuessed = true, amountSigned < 0 ? "out" : "in");

    const contact = cellFor(r, mapping, "contact") || "";
    const category = cellFor(r, mapping, "category") || "";
    const paymentMode = cellFor(r, mapping, "paymentMode") || "Cash";
    const remark = cellFor(r, mapping, "remark") || "";
    const addedBy = cellFor(r, mapping, "addedBy") || undefined;

    if (rowGuessed) guessed++;
    entries.push({
      id: uid(),
      type, date, time: cellFor(r, mapping, "time") || "",
      amount: Math.abs(amountSigned),
      contact, category, paymentMode,
      remark, receipt: null,
      addedBy,
      createdAt: new Date().toISOString(),
    });
  }

  if (entries.length === 0) {
    return { entries: [], error: t("bookSettings.importCsvErrorNoRows"), guessed: 0 };
  }
  return { entries, error: null, guessed };
}
