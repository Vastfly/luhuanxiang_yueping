create extension if not exists "pgcrypto";

create table if not exists public.admin_users (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

drop policy if exists "Admins can read themselves" on public.admin_users;
create policy "Admins can read themselves"
on public.admin_users
for select
using (email = auth.jwt() ->> 'email');

create table if not exists public.reviews (
  id text primary key,
  title text not null,
  album text not null,
  artist text not null,
  genre text,
  year text,
  score text,
  author text,
  published text,
  cover_url text,
  excerpt text,
  body jsonb not null default '[]'::jsonb,
  tracks jsonb not null default '[]'::jsonb,
  status text not null default 'published',
  created_at timestamptz not null default now()
);

alter table public.reviews enable row level security;

drop policy if exists "Public can read published reviews" on public.reviews;
create policy "Public can read published reviews"
on public.reviews
for select
using (status = 'published');

drop policy if exists "Anyone can insert prototype reviews" on public.reviews;
drop policy if exists "Admins can insert reviews" on public.reviews;
create policy "Admins can insert reviews"
on public.reviews
for insert
with check (
  exists (
    select 1 from public.admin_users
    where admin_users.email = auth.jwt() ->> 'email'
  )
);

drop policy if exists "Anyone can update prototype reviews" on public.reviews;
drop policy if exists "Admins can update reviews" on public.reviews;
create policy "Admins can update reviews"
on public.reviews
for update
using (
  exists (
    select 1 from public.admin_users
    where admin_users.email = auth.jwt() ->> 'email'
  )
)
with check (
  exists (
    select 1 from public.admin_users
    where admin_users.email = auth.jwt() ->> 'email'
  )
);

insert into storage.buckets (id, name, public)
values ('album-covers', 'album-covers', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public can read album covers" on storage.objects;
create policy "Public can read album covers"
on storage.objects
for select
using (bucket_id = 'album-covers');

drop policy if exists "Anyone can upload prototype album covers" on storage.objects;
drop policy if exists "Admins can upload album covers" on storage.objects;
create policy "Admins can upload album covers"
on storage.objects
for insert
with check (
  bucket_id = 'album-covers'
  and exists (
    select 1 from public.admin_users
    where admin_users.email = auth.jwt() ->> 'email'
  )
);
