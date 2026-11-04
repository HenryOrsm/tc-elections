-- Only needed if you ALREADY ran the old setup.sql before parties existed.
-- If you are setting up fresh, skip this: the new setup.sql already includes it.
-- Supabase > SQL Editor > New query > paste > Run.
alter table public.candidates
  add column if not exists party text not null default 'blue'
  check (party in ('blue','gold'));
-- Any candidate already on the ballot is now in the Blue Party. To move one to Gold:
--   update public.candidates set party = 'gold' where name = 'Their Name';
