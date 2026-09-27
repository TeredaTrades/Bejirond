-- Bejirond multi-user book/ledger sync — Phase 2b: push notifications
-- Run this AFTER 001, 002, 003, in the same Supabase project's SQL editor.

-- One row per (user, device). A user with two phones gets two rows.
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  created_at timestamptz not null default now(),
  unique (user_id, token)
);

alter table public.device_tokens enable row level security;

create policy "a user manages only their own device tokens"
  on public.device_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── notify-on-new-entry trigger ───────────────────────────────────
-- Fires the "notify-entry" Edge Function (deployed separately — see
-- supabase/functions/notify-entry/) whenever a new entry is inserted,
-- so it can push a notification to every OTHER member of that book.
-- Requires the pg_net extension (bundled with every Supabase project).
create extension if not exists pg_net with schema extensions;

-- The Edge Function URL and a shared secret it checks are baked directly
-- into the function body below rather than read from Postgres settings.
-- ALTER DATABASE SET is NOT permitted on Supabase's hosted plans (even
-- via the SQL editor) — confirmed by trying it: "ERROR: 42501:
-- permission denied to set parameter". So instead, after deploying
-- notify-entry and getting its real URL, re-run just this function with
-- your real values substituted directly into the literals below:
--
-- create or replace function public.notify_new_entry()
-- returns trigger language plpgsql security definer set search_path = public
-- as $$
-- begin
--   perform net.http_post(
--     url := 'https://<project-ref>.supabase.co/functions/v1/notify-entry',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', '<your random secret>'),
--     body := jsonb_build_object('book_id', new.book_id, 'entry_id', new.id, 'actor_id', new.created_by)
--   );
--   return new;
-- end;
-- $$;
--
-- The placeholder version below (using current_setting, which will
-- always return null since the settings can never be set) is what this
-- migration creates initially — it's a safe no-op until you replace it
-- with the block above containing your real values.

create or replace function public.notify_new_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := current_setting('app.notify_entry_url', true);
  v_secret text := current_setting('app.notify_entry_secret', true);
begin
  if v_url is null or v_secret is null then
    -- Not configured yet — skip silently rather than failing every insert.
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := jsonb_build_object('book_id', new.book_id, 'entry_id', new.id, 'actor_id', new.created_by)
  );
  return new;
end;
$$;

drop trigger if exists on_entry_insert_notify on public.entries;
create trigger on_entry_insert_notify
  after insert on public.entries
  for each row execute function public.notify_new_entry();
