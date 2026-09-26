// Thin Supabase client wrapper. Sync is opt-in per ledger (see
// docs/MULTI_USER_SYNC_SCOPE.md) — an app with no env vars set, or a
// user who never shares a business, never touches this at all.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Only created if both env vars are present, so a build without them
// (or the current local-only usage) never throws on import.
export const supabase = url && key ? createClient(url, key) : null;

export const isSyncConfigured = () => supabase !== null;
