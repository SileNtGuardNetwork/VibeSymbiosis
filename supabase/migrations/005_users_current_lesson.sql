alter table public.users
  add column if not exists current_lesson integer not null default 1;
