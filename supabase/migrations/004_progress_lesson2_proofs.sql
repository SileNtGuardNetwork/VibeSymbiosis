-- Флаги проверки скриншотов урока 2 (Gemini)
alter table public.progress
  add column if not exists vpn_proof_verified boolean not null default false;

alter table public.progress
  add column if not exists card_proof_verified boolean not null default false;
