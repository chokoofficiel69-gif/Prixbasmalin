-- Prix Malin: private price-alert subscriptions.
-- Apply only to a dedicated Prix Malin Supabase project, never the unrelated Job Agent project.
create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  product_name text not null,
  target_price_eur numeric(10,2) not null check (target_price_eur > 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  is_active boolean not null default true,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_alerts_user_product_target_unique unique (user_id, product_id, target_price_eur)
);

create index if not exists price_alerts_active_product_idx
  on public.price_alerts (product_id) where is_active = true;
create index if not exists price_alerts_user_created_idx
  on public.price_alerts (user_id, created_at desc);

alter table public.price_alerts enable row level security;

drop policy if exists "Users read own price alerts" on public.price_alerts;
create policy "Users read own price alerts"
  on public.price_alerts for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create own price alerts" on public.price_alerts;
create policy "Users create own price alerts"
  on public.price_alerts for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own price alerts" on public.price_alerts;
create policy "Users update own price alerts"
  on public.price_alerts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own price alerts" on public.price_alerts;
create policy "Users delete own price alerts"
  on public.price_alerts for delete to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.price_alerts is
  'Prix Malin user-defined target-price alerts. Notification delivery must be implemented separately server-side.';
