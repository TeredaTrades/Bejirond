import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Minus, ChevronRight, ChevronDown, ArrowLeft, X, Settings as SettingsIcon,
  Users, FileText, Search, MoreVertical, Building2, UserPlus, Info, Smartphone,
  Share2, HelpCircle, BookMarked, Wallet, TrendingUp, TrendingDown, Calendar,
  Clock, Trash2, Download, Printer, Eye, ShieldCheck, Check, ArrowRightLeft,
  Loader2, Inbox, ChevronLeft
} from "lucide-react";
import { Preferences } from "@capacitor/preferences";

// ---------- constants ----------
const DEFAULT_CATEGORIES = ["Home", "Electronics", "Food", "Salary", "Rent", "Transport", "Utilities", "Other"];
const DEFAULT_PAYMENT_MODES = ["Cash", "Online", "Card", "Cheque"];
const CURRENCIES = { "$": "USD", "Br": "ETB", "₹": "INR", "€": "EUR", "£": "GBP" };
const ROLES = ["Book Admin", "Data Operator", "Viewer"];
const BOOK_TEMPLATES = ["Sales Ledger", "Bank Reconciliation", "Shared Cashbook", "Payroll & Staff Expenses"];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const todayStr = () => new Date().toISOString().slice(0, 10);
const nowTimeStr = () => {
  const d = new Date();
  let h = d.getHours(); const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
};
const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
};

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

// ---------- small UI atoms ----------
function Chip({ active, children, onClick, tone = "teal" }) {
  const toneMap = {
    teal: active ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-600 border-slate-300",
    emerald: active ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-300",
    rose: active ? "bg-rose-600 text-white border-rose-600" : "bg-white text-slate-600 border-slate-300",
  };
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-full text-sm border font-medium transition-colors ${toneMap[tone]}`}>
      {children}
    </button>
  );
}

function TopHeader({ title, subtitle, onBack, right }) {
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

function BottomNav({ tab, setTab }) {
  const items = [
    { id: "books", label: "Cashbooks", icon: BookMarked },
    { id: "help", label: "Help", icon: HelpCircle },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];
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

// ---------- App ----------
export default function TallyBookApp() {
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(null);
  const [businesses, setBusinesses] = useState([]);
  const [session, setSession] = useState({ activeBusinessId: null, viewingAs: null });
  const [appSettings, setAppSettings] = useState({ categories: DEFAULT_CATEGORIES, paymentModes: DEFAULT_PAYMENT_MODES, currency: "$" });
  const [tab, setTab] = useState("books");
  const [stack, setStack] = useState([{ screen: "books" }]);
  const [entriesCache, setEntriesCache] = useState({}); // bookId -> entries
  const [activityCache, setActivityCache] = useState({}); // bookId -> activity

  const top = stack[stack.length - 1];
  const push = (screen, extra = {}) => setStack((s) => [...s, { screen, ...extra }]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const resetTo = (screen, extra = {}) => setStack([{ screen, ...extra }]);

  // ---- initial load ----
  useEffect(() => {
    (async () => {
      const ob = await storeGet("onboarding", null);
      const biz = await storeGet("businesses", []);
      const sess = await storeGet("session", { activeBusinessId: null, viewingAs: null });
      const settings = await storeGet("app-settings", { categories: DEFAULT_CATEGORIES, paymentModes: DEFAULT_PAYMENT_MODES, currency: "$" });
      setOnboarding(ob);
      setBusinesses(biz);
      setAppSettings(settings);
      const activeId = sess.activeBusinessId && biz.find(b => b.id === sess.activeBusinessId) ? sess.activeBusinessId : (biz[0]?.id || null);
      setSession({ ...sess, activeBusinessId: activeId });
      setLoading(false);
    })();
  }, []);

  const persistBusinesses = useCallback(async (next) => {
    setBusinesses(next);
    await storeSet("businesses", next);
  }, []);
  const persistSession = useCallback(async (next) => {
    setSession(next);
    await storeSet("session", next);
  }, []);
  const persistSettings = useCallback(async (next) => {
    setAppSettings(next);
    await storeSet("app-settings", next);
  }, []);

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
  }, []);

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
    return nb;
  };

  const createBook = async (name) => {
    if (!activeBusiness) return;
    const nbBook = { id: uid(), name, createdAt: new Date().toISOString() };
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, books: [...b.books, nbBook] } : b);
    await persistBusinesses(next);
    return nbBook;
  };

  if (loading) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-white">
        <Loader2 className="animate-spin text-teal-700" size={28} />
      </div>
    );
  }

  if (!onboarding?.done) {
    return (
      <Onboarding
        onDone={async (managing) => {
          const ob = { done: true, managing };
          await storeSet("onboarding", ob);
          setOnboarding(ob);
          if (businesses.length === 0) {
            const nb = { id: uid(), name: managing === "personal" ? "My Cashbook" : "My Business", createdAt: new Date().toISOString(), books: [], members: [], moveRequests: [] };
            await persistBusinesses([nb]);
            await persistSession({ activeBusinessId: nb.id, viewingAs: null });
          }
        }}
      />
    );
  }

  const ctx = {
    businesses, activeBusiness, session, appSettings, viewer, canManage, canAddEntries,
    persistBusinesses, persistSession, persistSettings,
    getEntries, saveEntries, getActivity, logActivity,
    createBusiness, createBook,
    push, pop, resetTo, stack, top,
  };

  return (
    <div className="w-full h-screen bg-slate-50 overflow-hidden flex flex-col">
      <div className="flex-1 overflow-y-auto flex flex-col">
        <Router ctx={ctx} tab={tab} setTab={setTab} />
      </div>
      {stack.length === 1 && (top.screen === "books" || top.screen === "help" || top.screen === "settings") && (
        <BottomNav tab={tab} setTab={(t) => { setTab(t); resetTo(t); }} />
      )}
    </div>
  );
}

// ---------- Onboarding ----------
function Onboarding({ onDone }) {
  const [choice, setChoice] = useState(null);
  const options = [
    { id: "business", label: "Business cash flow", icon: Building2 },
    { id: "personal", label: "Personal cash flow", icon: Wallet },
    { id: "explore", label: "Just exploring", icon: Info },
  ];
  return (
    <div className="w-full h-screen bg-white overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="w-5" />
        <button onClick={() => onDone("explore")} className="text-teal-700 text-sm font-medium">Skip</button>
      </div>
      <div className="h-1 flex gap-1 px-4">
        <div className="flex-1 bg-teal-700 rounded-full h-1" />
        <div className="flex-1 bg-slate-200 rounded-full h-1" />
      </div>
      <div className="flex-1 flex flex-col items-center px-6 pt-10">
        <div className="w-20 h-20 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center mb-8">
          <BookMarked size={36} className="text-teal-700" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 text-center">What will you manage?</h1>
        <p className="text-sm text-slate-500 text-center mt-1 mb-8">We'll tune your experience around it.</p>
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
          Next <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ---------- Router ----------
function Router({ ctx, tab, setTab }) {
  const { top } = ctx;
  switch (top.screen) {
    case "books": return <BooksScreen ctx={ctx} />;
    case "help": return <HelpScreen ctx={ctx} />;
    case "settings": return <SettingsScreen ctx={ctx} />;
    case "book": return <BookScreen ctx={ctx} bookId={top.bookId} />;
    case "addEntry": return <AddEntryScreen ctx={ctx} bookId={top.bookId} type={top.type} editEntry={top.editEntry} />;
    case "bookSettings": return <BookSettingsScreen ctx={ctx} bookId={top.bookId} />;
    case "addMember": return <AddMemberScreen ctx={ctx} bookId={top.bookId} />;
    case "reports": return <ReportsScreen ctx={ctx} bookId={top.bookId} />;
    case "reportView": return <ReportViewScreen ctx={ctx} bookId={top.bookId} filters={top.filters} />;
    case "businessTeam": return <BusinessTeamScreen ctx={ctx} />;
    case "moveRequests": return <MoveRequestsScreen ctx={ctx} />;
    case "businessSettings": return <BusinessSettingsScreen ctx={ctx} />;
    case "appSettings": return <AppSettingsScreen ctx={ctx} />;
    case "profile": return <ProfileScreen ctx={ctx} />;
    case "about": return <AboutScreen ctx={ctx} />;
    case "switchBusiness": return <SwitchBusinessScreen ctx={ctx} />;
    case "activity": return <ActivityScreen ctx={ctx} bookId={top.bookId} />;
    default: return <BooksScreen ctx={ctx} />;
  }
}

// ---------- Books list ----------
function BooksScreen({ ctx }) {
  const { activeBusiness, push, canManage } = ctx;
  const [showTemplates, setShowTemplates] = useState(false);
  const [newName, setNewName] = useState("");

  const addBook = async (name) => {
    if (!name.trim()) return;
    const b = await ctx.createBook(name.trim());
    setNewName(""); setShowTemplates(false);
    push("book", { bookId: b.id });
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-200 bg-white">
        <button onClick={() => push("switchBusiness")} className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Building2 size={18} /></div>
          <div className="text-left min-w-0">
            <div className="font-semibold text-slate-900 truncate max-w-[180px]">{activeBusiness?.name || "Select business"}</div>
            <div className="text-xs text-slate-500">Tap to switch business</div>
          </div>
          <ChevronDown size={16} className="text-slate-400 shrink-0" />
        </button>
        <button onClick={() => push("businessTeam")} className="p-2 text-teal-700"><UserPlus size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-500">Your Books</span>
          <Search size={18} className="text-slate-400" />
        </div>

        {(!activeBusiness || activeBusiness.books.length === 0) && (
          <EmptyState icon={BookMarked} title="No books yet" hint="Add your first book to start tracking cash in and out." />
        )}

        <div className="divide-y divide-slate-200 bg-white rounded-xl border border-slate-200">
          {activeBusiness?.books.map((bk) => (
            <button key={bk.id} onClick={() => push("book", { bookId: bk.id })} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
              <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><BookMarked size={16} /></div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 truncate">{bk.name}</div>
                <div className="text-xs text-slate-500">Created {fmtDate(bk.createdAt.slice(0,10))}</div>
              </div>
              <MoreVertical size={16} className="text-slate-300" />
            </button>
          ))}
        </div>

        {canManage && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="font-medium text-slate-800 mb-1">Add New Book</div>
            <div className="text-xs text-slate-500 mb-3">Click to quickly add books for</div>
            <div className="flex flex-wrap gap-2 mb-3">
              {BOOK_TEMPLATES.map((t) => (
                <Chip key={t} onClick={() => addBook(t)}>{t}</Chip>
              ))}
            </div>
            {showTemplates ? (
              <div className="flex gap-2">
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Book name"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                <button onClick={() => addBook(newName)} className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">Add</button>
              </div>
            ) : (
              <button onClick={() => setShowTemplates(true)} className="w-full flex items-center justify-center gap-1 bg-teal-700 text-white py-2.5 rounded-xl font-medium">
                <Plus size={18} /> Add new book
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SwitchBusinessScreen({ ctx }) {
  const { businesses, session, persistSession, pop, createBusiness } = ctx;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  return (
    <div className="flex-1 flex flex-col">
      <TopHeader title="Select Business" right={<button onClick={pop}><X size={20} className="text-slate-500" /></button>} />
      <div className="p-4 space-y-2 flex-1 overflow-y-auto">
        <div className="text-xs font-medium text-slate-400 uppercase mb-1">Your businesses</div>
        {businesses.map((b) => (
          <button key={b.id} onClick={async () => { await persistSession({ ...session, activeBusinessId: b.id, viewingAs: null }); pop(); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border ${session.activeBusinessId === b.id ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-white"}`}>
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700"><Building2 size={16} /></div>
            <div className="flex-1 text-left">
              <div className="font-medium text-slate-900">{b.name}</div>
              <div className="text-xs text-slate-500">{b.books.length} Book{b.books.length !== 1 ? "s" : ""}</div>
            </div>
            {session.activeBusinessId === b.id && <Check size={18} className="text-teal-700" />}
          </button>
        ))}
        {creating ? (
          <div className="flex gap-2 pt-2">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={async () => { if (name.trim()) { await createBusiness(name.trim()); pop(); } }}
              className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">Add</button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} className="w-full flex items-center justify-center gap-1 bg-teal-700 text-white py-3 rounded-xl font-semibold mt-2">
            <Plus size={18} /> Add new Business
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Book screen ----------
function BookScreen({ ctx, bookId }) {
  const { activeBusiness, push, pop, getEntries, appSettings, canAddEntries } = ctx;
  const book = activeBusiness?.books.find((b) => b.id === bookId);
  const [entries, setEntries] = useState(null);

  useEffect(() => { getEntries(bookId).then(setEntries); }, [bookId]);

  if (!book) return <EmptyState icon={BookMarked} title="Book not found" />;

  const totalIn = (entries || []).filter(e => e.type === "in").reduce((s, e) => s + e.amount, 0);
  const totalOut = (entries || []).filter(e => e.type === "out").reduce((s, e) => s + e.amount, 0);
  const net = totalIn - totalOut;
  const cur = appSettings.currency;

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader
        title={book.name}
        subtitle="Add Member, Book Activity etc"
        onBack={pop}
        right={
          <div className="flex items-center gap-1">
            <button onClick={() => push("addMember", { bookId })} className="p-2 text-teal-700"><UserPlus size={18} /></button>
            <button onClick={() => push("reports", { bookId })} className="p-2 text-teal-700"><FileText size={18} /></button>
            <button onClick={() => push("bookSettings", { bookId })} className="p-2 text-slate-500"><MoreVertical size={18} /></button>
          </div>
        }
      />
      <div className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Net Balance</span>
          <span className={`font-bold text-lg ${net >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{cur}{Math.abs(net).toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm text-slate-500">Total In (+)</span>
          <span className="text-emerald-600 font-medium">{cur}{totalIn.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm text-slate-500">Total Out (-)</span>
          <span className="text-rose-600 font-medium">{cur}{totalOut.toLocaleString()}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-700" size={24} /></div>
        ) : entries.length === 0 ? (
          <EmptyState icon={Wallet} title="No entries yet" hint="Add your first cash in or cash out entry below." />
        ) : (
          <div className="divide-y divide-slate-100">
            {[...entries].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).map((e) => (
              <button key={e.id} onClick={() => canAddEntries && push("addEntry", { bookId, editEntry: e })}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${e.type === "in" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
                  {e.type === "in" ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 truncate">{e.contact || e.category || (e.type === "in" ? "Cash In" : "Cash Out")}</div>
                  <div className="text-xs text-slate-500 truncate">{fmtDate(e.date)} · {e.time} · {e.paymentMode}{e.addedBy && e.addedBy !== "You" ? ` · by ${e.addedBy}` : ""}</div>
                </div>
                <div className={`font-semibold ${e.type === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                  {e.type === "in" ? "+" : "-"}{cur}{e.amount.toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {canAddEntries && (
        <div className="p-3 border-t border-slate-200 bg-white flex gap-2">
          <button onClick={() => push("addEntry", { bookId, type: "in" })}
            className="flex-1 flex items-center justify-center gap-1 bg-emerald-600 text-white py-2.5 rounded-xl font-semibold">
            <Plus size={18} /> Cash In
          </button>
          <button onClick={() => push("addEntry", { bookId, type: "out" })}
            className="flex-1 flex items-center justify-center gap-1 bg-rose-600 text-white py-2.5 rounded-xl font-semibold">
            <Minus size={18} /> Cash Out
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Add / Edit entry ----------
function AddEntryScreen({ ctx, bookId, type, editEntry }) {
  const { pop, getEntries, saveEntries, appSettings, logActivity, viewer, activeBusiness } = ctx;
  const isEdit = !!editEntry;
  const [form, setForm] = useState(editEntry || {
    type: type || "in", date: todayStr(), time: nowTimeStr(), amount: "", contact: "", remark: "", category: "", paymentMode: "Cash",
  });
  const [showMoreModes, setShowMoreModes] = useState(false);
  const [contacts, setContacts] = useState([]);

  useEffect(() => { getEntries(bookId).then((es) => {
    setContacts([...new Set(es.map(e => e.contact).filter(Boolean))]);
  }); }, [bookId]);

  const save = async (addAnother) => {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return;
    const es = await getEntries(bookId);
    let next;
    const payload = { ...form, amount: amt, addedBy: viewer.name };
    if (isEdit) {
      next = es.map((e) => e.id === editEntry.id ? { ...payload, id: editEntry.id } : e);
      await logActivity(bookId, `${viewer.name} edited an entry (${cur(appSettings)}${amt})`);
    } else {
      next = [...es, { ...payload, id: uid(), createdAt: new Date().toISOString() }];
      await logActivity(bookId, `${viewer.name} added ${form.type === "in" ? "Cash In" : "Cash Out"} of ${cur(appSettings)}${amt}`);
    }
    await saveEntries(bookId, next);
    if (addAnother) {
      setForm({ type: form.type, date: form.date, time: nowTimeStr(), amount: "", contact: "", remark: "", category: "", paymentMode: form.paymentMode });
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
      <TopHeader title={isEdit ? "Edit Entry" : `Add ${isIn ? "Cash In" : "Cash Out"} Entry`} onBack={pop}
        right={isEdit ? <button onClick={deleteEntry} className="p-2 text-rose-600"><Trash2 size={18} /></button> : null} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex gap-3">
          <label className="flex-1">
            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Calendar size={12} /> Date</div>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="flex-1">
            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Clock size={12} /> Time</div>
            <input type="text" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
        </div>

        <label className="block">
          <div className="text-xs text-teal-700 mb-1 font-medium">Amount *</div>
          <input autoFocus type="number" inputMode="decimal" value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="w-full border-2 border-teal-600 rounded-lg px-3 py-2 text-lg font-semibold" placeholder="0" />
        </label>

        <label className="block relative">
          <div className="text-xs text-slate-500 mb-1">Party Name (Contact)</div>
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
        <button onClick={() => save(false)} className={`flex-1 text-white py-2.5 rounded-xl font-semibold ${isIn ? "bg-emerald-600" : "bg-rose-600"}`}>Save</button>
      </div>
    </div>
  );
}
function cur(appSettings) { return appSettings.currency; }

// ---------- Book settings ----------
function BookSettingsScreen({ ctx, bookId }) {
  const { activeBusiness, pop, push, persistBusinesses, businesses, canManage, session, persistSession } = ctx;
  const book = activeBusiness?.books.find((b) => b.id === bookId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(book?.name || "");

  const doRename = async () => {
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, books: b.books.map(bk => bk.id === bookId ? { ...bk, name } : bk) } : b);
    await persistBusinesses(next);
    setRenaming(false);
  };

  const deleteBook = async () => {
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, books: b.books.filter(bk => bk.id !== bookId) } : b);
    await persistBusinesses(next);
    ctx.resetTo("books");
  };

  const members = activeBusiness?.members || [];

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader title="Book Settings" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
          <button onClick={deleteBook} className="w-full flex items-center justify-center gap-2 text-rose-600 border border-rose-200 rounded-xl py-3 font-medium">
            <Trash2 size={16} /> Delete Book
          </button>
        )}
      </div>
    </div>
  );
}

function ActivityScreen({ ctx, bookId }) {
  const { pop, getActivity } = ctx;
  const [activity, setActivity] = useState(null);
  useEffect(() => { getActivity(bookId).then(setActivity); }, [bookId]);
  return (
    <div className="flex-1 flex flex-col">
      <TopHeader title="Book Activity" onBack={pop} />
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
      <TopHeader title="Book Settings" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
              <button onClick={() => removeMember(m.id)} className="text-rose-500 p-1"><Trash2 size={14} /></button>
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
          <button onClick={addMember} className="w-full flex items-center justify-center gap-2 bg-teal-700 text-white py-2.5 rounded-xl font-semibold">
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

  const filters = { duration, entryType, member, cats, mode, reportType, bookName: book?.name };

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader title="Generate Report" onBack={pop} />
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
  if (f.mode2 && f.mode2 !== "All") list = list.filter(e => e.paymentMode === f.mode2);
  return list;
}

function ReportViewScreen({ ctx, bookId, filters }) {
  const { pop, getEntries, appSettings } = ctx;
  const [entries, setEntries] = useState(null);
  useEffect(() => { getEntries(bookId).then(setEntries); }, [bookId]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    return applyFilters(entries, { ...filters, mode2: filters.mode });
  }, [entries, filters]);

  const cur = appSettings.currency;
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

  const downloadCsv = () => {
    let rows = [];
    if (filters.reportType === "all") {
      rows.push(["Date", "Time", "Type", "Amount", "Contact", "Category", "Payment Mode", "Remark", "Added By"]);
      filtered.forEach(e => rows.push([e.date, e.time, e.type === "in" ? "Cash In" : "Cash Out", e.amount, e.contact, e.category, e.paymentMode, e.remark, e.addedBy || "You"]));
    } else if (filters.reportType === "category") {
      rows.push(["Category", "Total In", "Total Out"]);
      Object.entries(categorySummary).forEach(([k, v]) => rows.push([k, v.in || 0, v.out || 0]));
    } else {
      rows.push(["Payment Mode", "Total In", "Total Out"]);
      Object.entries(paymentSummary).forEach(([k, v]) => rows.push([k, v.in || 0, v.out || 0]));
    }
    const csv = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${filters.bookName || "report"}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (filters.mode === "excel" && entries !== null) {
    // trigger once automatically below via button; keep as manual to be safe on repeated renders
  }

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader title="Report" onBack={pop}
        right={<button onClick={() => window.print()} className="p-2 text-teal-700"><Printer size={18} /></button>} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4" id="report-printable">
        <div className="text-center">
          <div className="font-bold text-slate-900">{filters.bookName}</div>
          <div className="text-xs text-slate-500">{filters.duration} · {filters.entryType} {filters.member && filters.member !== "All" ? `· ${filters.member}` : ""}</div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1 bg-emerald-50 rounded-xl p-3 text-center">
            <div className="text-xs text-emerald-700">Total In</div>
            <div className="font-bold text-emerald-700">{cur}{totalIn.toLocaleString()}</div>
          </div>
          <div className="flex-1 bg-rose-50 rounded-xl p-3 text-center">
            <div className="text-xs text-rose-700">Total Out</div>
            <div className="font-bold text-rose-700">{cur}{totalOut.toLocaleString()}</div>
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
                <div className={e.type === "in" ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>
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
                  <div className="text-emerald-600">+{cur}{(v.in || 0).toLocaleString()}</div>
                  <div className="text-rose-600">-{cur}{(v.out || 0).toLocaleString()}</div>
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
                  <div className="text-emerald-600">+{cur}{(v.in || 0).toLocaleString()}</div>
                  <div className="text-rose-600">-{cur}{(v.out || 0).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="p-3 border-t border-slate-200 bg-white">
        {filters.mode === "excel" ? (
          <button onClick={downloadCsv} className="w-full flex items-center justify-center gap-2 bg-teal-700 text-white py-2.5 rounded-xl font-semibold">
            <Download size={16} /> Download CSV
          </button>
        ) : (
          <button onClick={() => window.print()} className="w-full flex items-center justify-center gap-2 bg-teal-700 text-white py-2.5 rounded-xl font-semibold">
            <Printer size={16} /> Print / Save as PDF
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Settings tab ----------
function SettingsScreen({ ctx }) {
  const { push } = ctx;
  const Item = ({ icon: Icon, title, sub, onClick }) => (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
      <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 shrink-0"><Icon size={16} /></div>
      <div className="flex-1"><div className="font-medium text-slate-900">{title}</div><div className="text-xs text-slate-500">{sub}</div></div>
      <ChevronRight size={16} className="text-slate-300" />
    </button>
  );
  return (
    <div className="flex-1 flex flex-col">
      <TopHeader title="Settings" />
      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-slate-100 bg-white">
          <Item icon={Users} title="Business Team" sub="Add, remove or change role" onClick={() => push("businessTeam")} />
          <Item icon={ArrowRightLeft} title="Move Book Requests" sub="Approve or deny requests" onClick={() => push("moveRequests")} />
          <Item icon={Building2} title="Business Settings" sub="Settings specific to this business" onClick={() => push("businessSettings")} />
        </div>
        <div className="px-4 py-2 text-xs font-medium text-slate-400 uppercase bg-slate-100">General Settings</div>
        <div className="divide-y divide-slate-100 bg-white">
          <Item icon={SettingsIcon} title="App Settings" sub="Currency, categories, payment modes" onClick={() => push("appSettings")} />
          <Item icon={Eye} title="Your Profile" sub="Name, mobile number, email" onClick={() => push("profile")} />
          <Item icon={Info} title="About TallyBook" sub="Privacy policy, T&C, About us" onClick={() => push("about")} />
        </div>
      </div>
    </div>
  );
}

function BusinessTeamScreen({ ctx }) {
  const { activeBusiness, pop } = ctx;
  const members = activeBusiness?.members || [];
  return (
    <div className="flex-1 flex flex-col">
      <TopHeader title="Business Team" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-teal-700 text-white flex items-center justify-center font-semibold">Y</div>
          <div className="flex-1"><div className="font-medium text-slate-900 text-sm">You</div><div className="text-xs text-slate-500">Primary Admin</div></div>
          <ShieldCheck size={16} className="text-teal-700" />
        </div>
        {members.length === 0 ? (
          <EmptyState icon={Users} title="No team members yet" hint="Add members from a book's settings to invite them here." />
        ) : members.map((m) => (
          <div key={m.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-300 text-white flex items-center justify-center font-semibold">{m.name[0]}</div>
            <div className="flex-1"><div className="font-medium text-slate-900 text-sm">{m.name}</div><div className="text-xs text-slate-500">{m.role} · {m.status === "pending" ? "Pending" : "Active"}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MoveRequestsScreen({ ctx }) {
  const { activeBusiness, businesses, persistBusinesses, pop } = ctx;
  const requests = (activeBusiness?.moveRequests || []);

  const respond = async (reqId, approve) => {
    const req = requests.find(r => r.id === reqId);
    if (!req) return;
    let next = businesses;
    if (approve) {
      const fromBiz = businesses.find(b => b.id === req.fromBusinessId);
      const bookToMove = fromBiz?.books.find(bk => bk.id === req.bookId);
      if (bookToMove) {
        next = businesses.map((b) => {
          if (b.id === req.fromBusinessId) return { ...b, books: b.books.filter(bk => bk.id !== req.bookId) };
          if (b.id === activeBusiness.id) return { ...b, books: [...b.books, bookToMove], moveRequests: b.moveRequests.filter(r => r.id !== reqId) };
          return b;
        });
      }
    } else {
      next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, moveRequests: b.moveRequests.filter(r => r.id !== reqId) } : b);
    }
    await persistBusinesses(next);
  };

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader title="Move Book Requests" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {requests.length === 0 ? (
          <EmptyState icon={Inbox} title="No pending requests" hint="Requests to move a book into this business will appear here." />
        ) : requests.map((r) => (
          <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="font-medium text-slate-900 text-sm">{r.bookName}</div>
            <div className="text-xs text-slate-500 mb-3">From {r.fromBusinessName}</div>
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

  const rename = async () => {
    const next = businesses.map((b) => b.id === activeBusiness.id ? { ...b, name } : b);
    await persistBusinesses(next);
  };

  const requestMove = async () => {
    if (!moveTarget || !moveBook) return;
    const book = activeBusiness.books.find(b => b.id === moveBook);
    const req = { id: uid(), bookId: moveBook, bookName: book.name, fromBusinessId: activeBusiness.id, fromBusinessName: activeBusiness.name };
    const next = businesses.map((b) => b.id === moveTarget ? { ...b, moveRequests: [...(b.moveRequests || []), req] } : b);
    await persistBusinesses(next);
    setMoveBook(""); setMoveTarget("");
  };

  const deleteBusiness = async () => {
    const next = businesses.filter((b) => b.id !== activeBusiness.id);
    await persistBusinesses(next);
    resetTo("books");
  };

  return (
    <div className="flex-1 flex flex-col">
      <TopHeader title="Business Settings" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">Business Name</div>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={rename} className="bg-teal-700 text-white px-3 rounded-lg text-sm font-medium">Save</button>
          </div>
        </div>

        {businesses.length > 1 && activeBusiness.books.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="font-medium text-slate-800 flex items-center gap-2"><ArrowRightLeft size={16} className="text-teal-700" /> Move a book to another business</div>
            <select value={moveBook} onChange={(e) => setMoveBook(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Select book</option>
              {activeBusiness.books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Select target business</option>
              {businesses.filter(b => b.id !== activeBusiness.id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button onClick={requestMove} className="w-full bg-teal-700 text-white py-2.5 rounded-xl font-semibold text-sm">Send Move Request</button>
          </div>
        )}

        <button onClick={deleteBusiness} className="w-full flex items-center justify-center gap-2 text-rose-600 border border-rose-200 rounded-xl py-3 font-medium">
          <Trash2 size={16} /> Delete Business
        </button>
      </div>
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
      <TopHeader title="App Settings" onBack={pop} />
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

function ProfileScreen({ ctx }) {
  const { pop } = ctx;
  const [profile, setProfile] = useState({ name: "", mobile: "", email: "" });
  useEffect(() => { storeGet("profile", { name: "", mobile: "", email: "" }).then(setProfile); }, []);
  const save = async (next) => { setProfile(next); await storeSet("profile", next); };
  return (
    <div className="flex-1 flex flex-col">
      <TopHeader title="Your Profile" onBack={pop} />
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
      <TopHeader title="About TallyBook" onBack={pop} />
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm text-slate-600">
        <p>TallyBook is a simple ledger for tracking cash in and cash out across businesses and books, with lightweight team roles and exportable reports.</p>
        <p>All your data is stored privately and stays on your account only.</p>
        <p className="text-xs text-slate-400 pt-4">Version 1.0.0 · Demo build</p>
      </div>
    </div>
  );
}

function HelpScreen() {
  return (
    <div className="flex-1 flex flex-col">
      <TopHeader title="Help" />
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {[
          ["How do I add a cash entry?", "Open a book, tap Cash In or Cash Out, fill in the amount and details, then Save."],
          ["How do I invite a team member?", "Open a book → the person-add icon in the header → Add Member, then set their role."],
          ["What do the roles mean?", "Book Admin: full control. Data Operator: can add entries. Viewer: read-only."],
          ["How do I export a report?", "Open a book → the report icon → choose filters and Generate Excel or PDF."],
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
