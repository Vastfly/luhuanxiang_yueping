# REVUE Deployment Notes

## 1. Supabase setup

1. Create a Supabase project.
2. Open the SQL editor.
3. Run `supabase/schema.sql`.
4. Create a Supabase Auth user for the editor account.
5. Add that editor email to `public.admin_users`:

```sql
insert into public.admin_users (email)
values ('editor@example.com')
on conflict (email) do nothing;
```

6. Go to Project Settings > API and copy:
   - Project URL
   - anon public key

## 2. Site configuration

Edit `assets/config.js`:

```js
window.REVUE_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_ANON_KEY",
  coverBucket: "album-covers"
};
```

When these values are empty, the site automatically uses browser `localStorage`.
When they are present, reviews are read from `public.reviews`, and uploaded cover files are stored in the public `album-covers` bucket.

## 3. Deploy

This is currently a static site. Deploy the project folder to Netlify or any static host.

For Netlify:

1. Create a new Netlify site.
2. Set publish directory to the project root.
3. No build command is required.
4. Deploy.

## 4. Security model

Published reviews are publicly readable. Creating and updating reviews, plus uploading album covers, requires a signed-in Supabase Auth user whose email is listed in `public.admin_users`.
