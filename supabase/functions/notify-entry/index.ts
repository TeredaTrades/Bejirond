// supabase/functions/notify-entry/index.ts
//
// Called by the Postgres trigger in docs/db/004_push_notifications.sql
// whenever a new entry is inserted into a synced book. Looks up every
// OTHER active member of that book, finds their registered device
// tokens, and pushes a notification via FCM's current HTTP v1 API
// (the old server-key API was shut down by Google in 2024, so this has
// to go through OAuth using a Firebase service account — see
// docs/MULTI_USER_SYNC_SCOPE.md / PROJECT_LOG.md for the setup steps).
//
// Deploy: supabase functions deploy notify-entry --no-verify-jwt
// Secrets needed (supabase secrets set ...):
//   NOTIFY_SECRET              — must match app.notify_entry_secret in Postgres
//   FCM_SERVICE_ACCOUNT_JSON   — the full Firebase service account JSON, as one string
//   FCM_PROJECT_ID             — the Firebase project id (same one in google-services.json)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically
// to every Edge Function — no need to set those.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

function pemToBinary(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getFcmAccessToken(serviceAccount: { client_email: string; private_key: string }) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBinary(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const jwt = await create(
    { alg: "RS256", typ: "JWT" },
    {
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: getNumericDate(0),
      exp: getNumericDate(3600),
    },
    key,
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`FCM auth failed: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-notify-secret") !== Deno.env.get("NOTIFY_SECRET")) {
      return new Response("Forbidden", { status: 403 });
    }

    const { book_id, entry_id, actor_id } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [{ data: entryRow }, { data: bookRow }, { data: members }] = await Promise.all([
      supabase.from("entries").select("data").eq("id", entry_id).single(),
      supabase.from("books").select("name").eq("id", book_id).single(),
      supabase.from("book_members").select("user_id").eq("book_id", book_id).eq("status", "active").neq("user_id", actor_id),
    ]);

    const recipientIds = (members || []).map((m) => m.user_id);
    if (recipientIds.length === 0) return new Response("ok (no other members)", { status: 200 });

    const { data: tokens } = await supabase.from("device_tokens").select("token").in("user_id", recipientIds);
    if (!tokens || tokens.length === 0) return new Response("ok (no device tokens)", { status: 200 });

    const serviceAccount = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")!);
    const projectId = Deno.env.get("FCM_PROJECT_ID")!;
    const accessToken = await getFcmAccessToken(serviceAccount);

    const amount = entryRow?.data?.amount;
    const type = entryRow?.data?.type;
    const bookName = bookRow?.name || "your business";
    const title = bookName;
    const body = amount != null ? `New ${type || "entry"}: ${amount}` : "A new entry was added";

    const results = await Promise.allSettled(
      tokens.map((t) =>
        fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: { token: t.token, notification: { title, body } } }),
        })
      ),
    );

    return new Response(JSON.stringify({ sent: results.length }), { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response(String(e), { status: 500 });
  }
});
