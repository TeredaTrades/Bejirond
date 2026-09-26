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

-- The Edge Function URL and a shared secret it checks are stored as
-- Postgres settings rather than hardcoded, so they can be set once via
-- SQL without editing this file. Run, once, with your real values:
--   alter database postgres set app.notify_entry_url = 'https://<project-ref>.functions.supabase.co/notify-entry';
--   alter database postgres set app.notify_entry_secret = '<a random string you choose>';
-- (Both are also referenced in the client hookup — see cloudSync.js.)

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
