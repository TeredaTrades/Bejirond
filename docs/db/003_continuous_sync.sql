-- Bejirond multi-user book/ledger sync — Phase 2: continuous sync
-- Run this AFTER 001 and 002, in the same Supabase project's SQL editor.

-- A stable per-device entry id is needed so repeated saves can be
-- upserted (update-in-place) instead of creating duplicate rows every
-- time an entry is edited. entries.data already carries the app's own
-- entry.id, so backfill from that rather than inventing anything new.
alter table public.entries add column if not exists local_id text;
update public.entries set local_id = data->>'id' where local_id is null;
alter table public.entries alter column local_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'entries_book_local_unique'
  ) then
    alter table public.entries
      add constraint entries_book_local_unique unique (book_id, local_id);
  end if;
end $$;

-- Enable Realtime so a second device sees changes live while a shared
-- book is open, instead of only on next share/join.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entries'
  ) then
    execute 'alter publication supabase_realtime add table public.entries';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'book_members'
  ) then
    execute 'alter publication supabase_realtime add table public.book_members';
  end if;
end $$;
