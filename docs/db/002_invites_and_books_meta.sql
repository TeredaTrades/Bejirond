-- Bejirond multi-user book/ledger sync — invite-by-code + books metadata
-- Run this AFTER 001_multi_user_sync.sql, in the same Supabase project's
-- SQL editor.

-- A shared "book" row in Supabase maps to one of the app's local
-- "ledgers" (a business with a team) — a ledger can contain several
-- local cash-books, so we keep a small manifest of them here.
alter table public.books
  add column if not exists books_meta jsonb not null default '[]'::jsonb;

-- ── invites ───────────────────────────────────────────────────────
-- Invite-by-code (Phase 1, per docs/MULTI_USER_SYNC_SCOPE.md): a Book
-- Admin generates a row here; the id itself IS the invite code. Anyone
-- signed in can redeem an unused, unexpired invite via redeem_invite().
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  role text not null check (role in ('book_admin', 'data_operator', 'viewer')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid references auth.users(id),
  used_at timestamptz
);

alter table public.invites enable row level security;

create policy "book admins can create invites"
  on public.invites for insert
  with check (public.has_book_role(book_id, 'book_admin') and created_by = auth.uid());

create policy "book admins can view their book's invites"
  on public.invites for select
  using (public.has_book_role(book_id, 'book_admin'));

-- Anyone signed in can look up ONE unused, unexpired invite by its id
-- (the id/code is the secret — this is what lets a brand-new member,
-- who isn't in book_members yet, see just enough to redeem it).
create policy "a signed-in user can view an unused invite by id"
  on public.invites for select
  using (auth.role() = 'authenticated' and used_by is null and expires_at > now());

-- ── redeem_invite ─────────────────────────────────────────────────
create or replace function public.redeem_invite(p_invite_id uuid)
returns table(book_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites%rowtype;
begin
  select * into v_invite from public.invites
  where id = p_invite_id and used_by is null and expires_at > now();

  if not found then
    raise exception 'Invite not found, already used, or expired';
  end if;

  insert into public.book_members (book_id, user_id, role, invited_by, status)
  values (v_invite.book_id, auth.uid(), v_invite.role, v_invite.created_by, 'active')
  on conflict (book_id, user_id) do update set role = excluded.role, status = 'active';

  update public.invites set used_by = auth.uid(), used_at = now() where id = p_invite_id;

  return query select v_invite.book_id, v_invite.role;
end;
$$;

grant execute on function public.redeem_invite(uuid) to authenticated;
