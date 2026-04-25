-- Симбиоз: начальная схема (users, progress, payments)
-- timestamptz = timestamp with time zone

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  username text,
  current_state text not null default 'start',
  tier text not null default 'free',
  created_at timestamptz not null default now()
);

create table if not exists public.progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  lesson_number integer not null,
  status text not null default 'pending',
  deadline_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  ykassa_payment_id text unique,
  amount integer not null,
  status text not null default 'pending',
  tier_purchased text not null,
  created_at timestamptz not null default now()
);
