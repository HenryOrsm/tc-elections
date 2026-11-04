-- World Election: database setup.
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run once on a fresh project.

-- ============ tables ============

create table public.candidates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 40),
  mc_username text not null check (mc_username ~ '^[A-Za-z0-9_. ]{3,32}$' and mc_username = btrim(mc_username)),
  home_nation text not null default 'other'
              check (home_nation in ('maradon','goldleaf','dyonisia','seafaria','narellan','cecilia','eldonia','island-a','island-b','other')),
  pitch       text check (char_length(pitch) <= 140),
  color       text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  approved    boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index candidates_name_key on public.candidates (lower(name));
create unique index candidates_user_key on public.candidates (lower(mc_username));

create table public.votes (
  id          uuid primary key default gen_random_uuid(),
  mc_username text not null check (mc_username ~ '^[A-Za-z0-9_. ]{3,32}$' and mc_username = btrim(mc_username)),
  nation      text not null
              check (nation in ('maradon','goldleaf','dyonisia','seafaria','narellan','cecilia','eldonia','island-a','island-b')),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  created_at  timestamptz not null default now()
);
-- One vote per Minecraft username, no matter how it is capitalised.
create unique index votes_one_per_user on public.votes (lower(mc_username));

-- Who counts as an admin. Add your own email below, then create that user in
-- Authentication > Users with a password.
create table public.admin_emails (email text primary key);
insert into public.admin_emails (email) values ('narellanfederalcourt1874@gmail.com');

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.am_i_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin();
$$;

-- ============ results: totals only, never usernames ============

create or replace function public.get_results()
returns table (nation text, candidate_id uuid, votes bigint)
language sql stable security definer set search_path = public as $$
  select v.nation, v.candidate_id, count(*)::bigint
  from public.votes v
  join public.candidates c on c.id = v.candidate_id
  where c.approved
  group by v.nation, v.candidate_id;
$$;

-- ============ row level security ============

alter table public.candidates   enable row level security;
alter table public.votes        enable row level security;
alter table public.admin_emails enable row level security;  -- no policies: nobody but the dashboard can touch it

-- candidates
create policy "anyone sees approved candidates" on public.candidates
  for select to anon, authenticated using (approved = true);
create policy "admin sees all candidates" on public.candidates
  for select to authenticated using (public.is_admin());
create policy "anyone can apply, unapproved" on public.candidates
  for insert to anon, authenticated with check (approved = false and color is null);
create policy "admin edits candidates" on public.candidates
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes candidates" on public.candidates
  for delete to authenticated using (public.is_admin());

-- votes
create policy "anyone can vote for an approved candidate" on public.votes
  for insert to anon, authenticated
  with check (exists (select 1 from public.candidates c where c.id = candidate_id and c.approved));
create policy "admin sees votes" on public.votes
  for select to authenticated using (public.is_admin());
create policy "admin deletes votes" on public.votes
  for delete to authenticated using (public.is_admin());

-- ============ permissions ============

revoke all on public.admin_emails from anon, authenticated;
grant select on public.candidates to anon, authenticated;
grant insert on public.candidates to anon, authenticated;
grant update, delete on public.candidates to authenticated;
grant insert on public.votes to anon, authenticated;
grant select, delete on public.votes to authenticated;

revoke all on function public.get_results() from public;
grant execute on function public.get_results() to anon, authenticated;
revoke all on function public.is_admin() from public;
revoke all on function public.am_i_admin() from public;
grant execute on function public.am_i_admin() to authenticated;
