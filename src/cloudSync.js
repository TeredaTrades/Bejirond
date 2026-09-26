// Multi-user book/ledger sync — Phase 1 (see docs/MULTI_USER_SYNC_SCOPE.md).
//
// Scope of this file, deliberately: sign up/in/out, turning a local
// ledger into a shared one (with a one-time upload of its existing
// entries as seed data), generating/redeeming invite codes, and pulling
// a shared ledger's current entries down to a new device on join.
//
// NOT yet in this file (planned next): continuous push-on-every-edit
// sync, realtime subscriptions, and conflict handling beyond "the seed
// upload / join pull are last-write wins by virtue of being one-shot."
// Wiring this into saveEntries() for live sync is the next increment.
import { supabase } from "./supabaseClient";

function requireSupabase() {
  if (!supabase) throw new Error("Cloud sync isn't configured (missing Supabase env vars).");
  return supabase;
}

// ---------- auth ----------
export async function signUpEmail(email, password) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signInEmail(email, password) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOutCloud() {
  const sb = requireSupabase();
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function getCloudUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

// Fires immediately with the current session, then on every change.
export function onCloudAuthChange(callback) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user || null);
  });
  return () => data.subscription.unsubscribe();
}

// ---------- sharing a ledger ----------
// Turns a local-only ledger into a synced one: creates the remote
// "books" row (one per ledger — the name is historical, see the SQL
// migration's comment), records the current user as primary_admin,
// stores a manifest of the ledger's local cash-books, and uploads
// every existing entry from every one of those books as seed data.
//
// getEntriesForBook: async (localBookId) => entry[]  — pass ctx.getEntries.
export async function shareLedger(ledger, getEntriesForBook) {
  const sb = requireSupabase();
  const user = await getCloudUser();
  if (!user) throw new Error("Sign in first.");

  const booksMeta = ledger.books.map((b) => ({ id: b.id, name: b.name }));

  const { data: bookRow, error: bookErr } = await sb
    .from("books")
    .insert({ name: ledger.name, created_by: user.id, books_meta: booksMeta })
    .select()
    .single();
  if (bookErr) throw bookErr;

  const { error: memberErr } = await sb.from("book_members").insert({
    book_id: bookRow.id,
    user_id: user.id,
    role: "primary_admin",
    invited_by: user.id,
    status: "active",
  });
  if (memberErr) throw memberErr;

  // Seed upload: every existing entry from every local book, tagged
  // with which local book it came from so a joining device can sort
  // them back into the right book.
  const rows = [];
  for (const b of ledger.books) {
    const entries = await getEntriesForBook(b.id);
    for (const entry of entries) {
      rows.push({
        book_id: bookRow.id,
        data: { ...entry, localBookId: b.id },
        created_by: user.id,
        updated_by: user.id,
      });
    }
  }
  if (rows.length > 0) {
    const { error: entriesErr } = await sb.from("entries").insert(rows);
    if (entriesErr) throw entriesErr;
  }

  return bookRow.id; // store this as ledger.remoteId locally
}

// ---------- invites ----------
export async function createInvite(remoteBookId, role) {
  const sb = requireSupabase();
  const user = await getCloudUser();
  if (!user) throw new Error("Sign in first.");
  const { data, error } = await sb
    .from("invites")
    .insert({ book_id: remoteBookId, role, created_by: user.id })
    .select()
    .single();
  if (error) throw error;
  return data.id; // this UUID is the invite code shared with the invitee
}

// Redeems a code for the signed-in user, then pulls down the shared
// ledger's current state (books manifest + all entries) so the new
// device has something to show immediately.
export async function joinWithInviteCode(code) {
  const sb = requireSupabase();
  const user = await getCloudUser();
  if (!user) throw new Error("Sign in first.");

  const { data: redeemed, error: redeemErr } = await sb.rpc("redeem_invite", { p_invite_id: code });
  if (redeemErr) throw redeemErr;
  const bookId = redeemed?.[0]?.book_id;
  if (!bookId) throw new Error("Invite redemption did not return a book.");

  const { data: bookRow, error: bookErr } = await sb.from("books").select("*").eq("id", bookId).single();
  if (bookErr) throw bookErr;

  const { data: entries, error: entriesErr } = await sb.from("entries").select("*").eq("book_id", bookId);
  if (entriesErr) throw entriesErr;

  return { bookRow, entries: entries || [] };
}

export async function fetchRemoteMembers(remoteBookId) {
  const sb = requireSupabase();
  const { data, error } = await sb.from("book_members").select("*").eq("book_id", remoteBookId);
  if (error) throw error;
  return data || [];
}
