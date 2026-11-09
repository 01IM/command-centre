-- Command Centre: one-time setup for your free Supabase project.
-- Paste all of this into Supabase → SQL Editor → New query, then click "Run".
-- Everything stored here is encrypted on your devices first; this only creates private, per-user storage.

create table if not exists public.items (
  user_id    uuid    not null default auth.uid() references auth.users on delete cascade,
  collection text    not null,
  id         text    not null,
  updated_at bigint  not null,
  deleted    boolean not null default false,
  payload    text,
  server_ts  timestamptz not null default now(),
  primary key (user_id, collection, id)
);
create index if not exists items_user_server_ts on public.items (user_id, server_ts);

-- server_ts always reflects the time the server received the change (used for "what's new since…")
create or replace function public.items_touch() returns trigger language plpgsql as $$
begin new.server_ts := clock_timestamp(); return new; end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items for each row execute function public.items_touch();

-- Only you can see or change your rows
alter table public.items enable row level security;
drop policy if exists "own rows" on public.items;
create policy "own rows" on public.items for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.items to authenticated;

-- Private bucket for your (encrypted) files
insert into storage.buckets (id, name, public) values ('vault', 'vault', false) on conflict (id) do nothing;
drop policy if exists "vault own read" on storage.objects;
drop policy if exists "vault own insert" on storage.objects;
drop policy if exists "vault own update" on storage.objects;
drop policy if exists "vault own delete" on storage.objects;
create policy "vault own read"   on storage.objects for select to authenticated using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault own insert" on storage.objects for insert to authenticated with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault own update" on storage.objects for update to authenticated using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault own delete" on storage.objects for delete to authenticated using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
