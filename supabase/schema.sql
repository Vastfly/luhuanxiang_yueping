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
  status text not null default 'pending',
  review_note text,
  user_id uuid references auth.users(id) on delete set null,
  submitter_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_status_check check (status in ('pending', 'published', 'rejected'))
);

alter table public.reviews add column if not exists review_note text;
alter table public.reviews add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.reviews add column if not exists submitter_email text;
alter table public.reviews add column if not exists updated_at timestamptz not null default now();

alter table public.reviews enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where admin_users.email = auth.jwt() ->> 'email'
  );
$$;

create or replace function public.is_verified_user()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users
    where id = auth.uid()
      and email_confirmed_at is not null
  );
$$;

create or replace function public.set_review_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_review_updated_at on public.reviews;
create trigger set_review_updated_at
before update on public.reviews
for each row
execute function public.set_review_updated_at();

drop policy if exists "Public can read published reviews" on public.reviews;
create policy "Public can read published reviews"
on public.reviews
for select
using (status = 'published');

drop policy if exists "Submitters can read their reviews" on public.reviews;
create policy "Submitters can read their reviews"
on public.reviews
for select
using (auth.uid() = user_id);

drop policy if exists "Admins can read all reviews" on public.reviews;
create policy "Admins can read all reviews"
on public.reviews
for select
using (public.is_admin());

drop policy if exists "Anyone can insert prototype reviews" on public.reviews;
drop policy if exists "Admins can insert reviews" on public.reviews;
drop policy if exists "Verified users can submit reviews" on public.reviews;
create policy "Verified users can submit reviews"
on public.reviews
for insert
with check (
  auth.uid() = user_id
  and submitter_email = auth.jwt() ->> 'email'
  and public.is_verified_user()
  and status = 'pending'
);

drop policy if exists "Anyone can update prototype reviews" on public.reviews;
drop policy if exists "Admins can update reviews" on public.reviews;
drop policy if exists "Admins can moderate reviews" on public.reviews;
create policy "Admins can moderate reviews"
on public.reviews
for update
using (public.is_admin())
with check (public.is_admin());

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
drop policy if exists "Verified users can upload album covers" on storage.objects;
create policy "Verified users can upload album covers"
on storage.objects
for insert
with check (
  bucket_id = 'album-covers'
  and auth.uid() is not null
  and public.is_verified_user()
  and (storage.foldername(name))[1] = auth.uid()::text
);
