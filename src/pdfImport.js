import * as pdfjsLib from "pdfjs-dist";

// The worker file is copied into public/ (see package.json postinstall-free
// manual copy step) so it resolves relative to index.html on both a plain
// web/PWA build and a Capacitor (file://) build, matching vite.config.js's
// base: "./".
pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

// ---------- best-effort recovery from the app's own PDF report ----------
// The PDF export (buildReportPdfBase64 in App.jsx) only ever carries 4
// columns for an "All Entries" report — Date, Type, Amount, Contact/Category
// — versus the CSV export's 9 fields. That's a lossy format by design (it's
// a printable report, not a data interchange format), so this importer can
// only ever recover an approximation of the original entries:
//   - Payment mode, remark, and "added by" are not in the PDF at all.
//   - Contact and Category were exported into a single merged cell, so we
//     can't tell which one the original value was — it's recovered into
//     "contact" and left for the person to re-categorize.
// This exists so people who only have an old PDF (already shared/saved
// somewhere, or made by an old app version that hasn't been updated yet)
// aren't stuck — not as a substitute for the CSV export/import round trip,
// which stays lossless and is the recommended path going forward.

// jsPDF draws each cell as its own separate text() call at a fixed x
// position, so pdfjs' getTextContent() returns one text item per cell for a
// data row: [date, "Cash In"/"Cash Out", amount, contact/category]. Title,
// subtitle, and total lines are drawn as 1-2 items, and the header row's
// second item is the literal word "Type" — so filtering to lines with
// exactly 4 items whose 2nd item is "Cash In"/"Cash Out" (hardcoded English
// in the export, regardless of app language — see reportTable in App.jsx)
// reliably isolates data rows from everything else on the page.
const TYPE_CELL_RE = /^Cash (In|Out)$/;

async function extractLines(arrayBuffer) {
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const lines = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    // Group items by their y position (rounded, since jsPDF writes an exact
    // baseline per row and floating point noise is negligible at this
    // tolerance) then sort left-to-right within each row.
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, str: item.str.trim() });
    }
    for (const [, cells] of rows) {
      cells.sort((a, b) => a.x - b.x);
      lines.push(cells.map((c) => c.str));
    }
  }
  return lines;
}

// ---------- date recovery ----------
// The Date column is rendered via fmtDate(iso) — Intl.toLocaleDateString
// with { day: "2-digit", month: "short", year: "numeric" }, in whichever
// language/calendar (Gregorian or Ethiopian) was active when the PDF was
// made. There's no reliable way to parse an arbitrary localized/calendar
// date string directly, but the app only ever produces one of a small,
// known set of (language x calendar) formatting combinations — so instead
// of parsing, we brute-force a reverse lookup: format every day in a wide
// date range every possible way the app could have, once, and match the
// PDF's literal string against that table. This sidesteps digit-script
// issues too (Arabic-Indic numerals, etc.) since the table is generated
// with the exact same Intl call and will contain the same script.
const DATE_LANGS = ["en", "am", "om", "ti", "fr", "ar", "sw"];
const dateLocale = (lang, calendarType) =>
  calendarType === "ethiopian" ? `${lang}-u-ca-ethiopic` : lang;

let dateLookup = null;
function buildDateLookup() {
  if (dateLookup) return dateLookup;
  const map = new Map();
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear() - 12, 0, 1);
  const end = Date.UTC(now.getUTCFullYear() + 3, 11, 31);
  const formatters = [];
  for (const lang of DATE_LANGS) {
    for (const calendarType of ["gregorian", "ethiopian"]) {
      try {
        formatters.push(
          new Intl.DateTimeFormat(dateLocale(lang, calendarType), {
            day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
          })
        );
      } catch {
        // Unsupported locale/calendar combo on this JS engine — skip it,
        // best-effort still covers whatever combos are supported.
      }
    }
  }
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (let t = start; t <= end; t += DAY_MS) {
    const iso = new Date(t).toISOString().slice(0, 10);
    for (const fmt of formatters) {
      const key = fmt.format(new Date(t));
      if (!map.has(key)) map.set(key, iso);
    }
  }
  dateLookup = map;
  return map;
}

function parseDateCell(raw) {
  return buildDateLookup().get(String(raw || "").trim()) || null;
}

// ---------- amount recovery ----------
// Amount cells are `${cur}${amount.toLocaleString()}` — an arbitrary
// currency symbol/code with no separator, followed by a number formatted
// with whatever locale the device/browser defaulted to when the PDF was
// made (not necessarily the app's selected language), which can include
// Arabic-Indic digits and either "," or "." as the decimal separator.
function normalizeDigits(str) {
  return str
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}
function parseAmountCell(raw) {
  const s = normalizeDigits(String(raw || ""));
  const m = s.match(/[0-9][0-9.,\s]*[0-9]|[0-9]/);
  if (!m) return NaN;
  let numStr = m[0].replace(/\s/g, "");
  const lastSep = Math.max(numStr.lastIndexOf(","), numStr.lastIndexOf("."));
  const fracLen = numStr.length - lastSep - 1;
  if (lastSep !== -1 && fracLen >= 1 && fracLen <= 2) {
    numStr = `${numStr.slice(0, lastSep).replace(/[.,]/g, "")}.${numStr.slice(lastSep + 1)}`;
  } else {
    numStr = numStr.replace(/[.,]/g, "");
  }
  const n = Number(numStr);
  return Number.isFinite(n) ? n : NaN;
}

// Reads a File (the PDF report) and returns { entries, error, skipped }.
// - entries: successfully-recovered rows, ready to append to a book (same
//   shape parseEntriesCsv produces, minus fields the PDF never had).
// - error: a translated message if the file didn't look like one of this
//   app's "All Entries" PDF reports at all.
// - skipped: count of rows that had a valid "Cash In"/"Cash Out" row shape
//   but whose date or amount couldn't be recovered (unsupported locale,
//   unusual number formatting, etc.) — included so the UI can be honest
//   about a partial recovery rather than silently dropping rows.
export async function parsePdfEntries(file, t, uid) {
  let lines;
  try {
    const buf = await file.arrayBuffer();
    lines = await extractLines(buf);
  } catch (err) {
    console.error("PDF text extraction failed", err);
    return { entries: [], error: t("bookSettings.importPdfErrorFormat"), skipped: 0 };
  }

  const dataLines = lines.filter((cells) => cells.length === 4 && TYPE_CELL_RE.test(cells[1]));
  if (dataLines.length === 0) {
    return { entries: [], error: t("bookSettings.importPdfErrorFormat"), skipped: 0 };
  }

  const entries = [];
  let skipped = 0;
  for (const [dateCell, typeCell, amountCell, contactCategoryCell] of dataLines) {
    const date = parseDateCell(dateCell);
    const amount = parseAmountCell(amountCell);
    if (!date || !Number.isFinite(amount)) { skipped++; continue; }
    const contactCategory = contactCategoryCell === "-" ? "" : contactCategoryCell;
    entries.push({
      id: uid(),
      type: /Out/.test(typeCell) ? "out" : "in",
      date, time: "",
      amount,
      contact: contactCategory, category: "", paymentMode: "Cash",
      remark: "", receipt: null,
      addedBy: undefined,
      createdAt: new Date().toISOString(),
    });
  }

  if (entries.length === 0) {
    return { entries: [], error: t("bookSettings.importPdfErrorNoRows"), skipped };
  }
  return { entries, error: null, skipped };
}
