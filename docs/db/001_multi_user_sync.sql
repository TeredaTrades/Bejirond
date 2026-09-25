-- Bejirond multi-user book/ledger sync — initial schema
-- Run this once in the Supabase SQL editor of whichever project is
-- chosen for Bejirond (see docs/MULTI_USER_SYNC_SCOPE.md).
-- Safe to run on a fresh project. Uses Supabase Auth's built-in
-- auth.users — no separate users table needed.

-- ── books ──────────────────────────────────────────────────────────
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'ETB',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.books enable row level security;

-- ── book_members ──────────────────────────────────────────────────
create table if not exists public.book_members (
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('primary_admin', 'book_admin', 'data_operator', 'viewer')),
  invited_by uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'active')),
  created_at timestamptz not null default now(),
  primary key (book_id, user_id)
);

alter table public.book_members enable row level security;

-- ── entries ───────────────────────────────────────────────────────
-- Mirrors the local entry shape from src/App.jsx. Extend columns here
-- as needed to match the real local entry fields 1:1 before Phase 1
-- ships (remark, category, payment_mode, contact, amount, type, date,
-- receipt_url, etc.) — kept minimal here since exact fields should be
-- copied from App.jsx at implementation time, not guessed.
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  data jsonb not null, -- full entry payload; see note above
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.entries enable row level security;

-- ── activity_log ──────────────────────────────────────────────────
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  action text not null,
  params jsonb,
  created_at timestamptz not null default now()
);

alter table public.activity_log enable row level security;

-- ── helper: does the current user have at least `min_role` on a book? ──
create or replace function public.has_book_role(p_book_id uuid, p_min_role text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.book_members bm
    where bm.book_id = p_book_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
      and (
        p_min_role = 'viewer'
        or (p_min_role = 'data_operator' and bm.role in ('data_operator', 'book_admin', 'primary_admin'))
        or (p_min_role = 'book_admin' and bm.role in ('book_admin', 'primary_admin'))
        or (p_min_role = 'primary_admin' and bm.role = 'primary_admin')
      )
  );
$$;

-- ── RLS: books ────────────────────────────────────────────────────
create policy "members can view their books"
  on public.books for select
  using (public.has_book_role(id, 'viewer'));

create policy "any signed-in user can create a book"
  on public.books for insert
  with check (created_by = auth.uid());

create policy "book admins can update book"
  on public.books for update
  using (public.has_book_role(id, 'book_admin'));

create policy "primary admin can delete book"
  on public.books for delete
  using (public.has_book_role(id, 'primary_admin'));

-- ── RLS: book_members ────────────────────────────────────────────
create policy "members can view membership of their books"
  on public.book_members for select
  using (public.has_book_role(book_id, 'viewer'));

create policy "book admins can invite members"
  on public.book_members for insert
  with check (public.has_book_role(book_id, 'book_admin'));

create policy "book admins can update member roles"
  on public.book_members for update
  using (public.has_book_role(book_id, 'book_admin'));

create policy "book admins can remove members"
  on public.book_members for delete
  using (public.has_book_role(book_id, 'book_admin'));

-- ── RLS: entries ──────────────────────────────────────────────────
create policy "members can view entries"
  on public.entries for select
  using (public.has_book_role(book_id, 'viewer'));

create policy "data operators can add entries"
  on public.entries for insert
  with check (public.has_book_role(book_id, 'data_operator') and created_by = auth.uid());

create policy "data operators can edit entries"
  on public.entries for update
  using (public.has_book_role(book_id, 'data_operator'));

create policy "data operators can delete entries"
  on public.entries for delete
  using (public.has_book_role(book_id, 'data_operator'));

-- ── RLS: activity_log ─────────────────────────────────────────────
create policy "members can view activity log"
  on public.activity_log for select
  using (public.has_book_role(book_id, 'viewer'));

create policy "members can write activity log"
  on public.activity_log for insert
  with check (public.has_book_role(book_id, 'viewer') and actor_id = auth.uid());
