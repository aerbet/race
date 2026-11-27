-- Настройки игрока в профиле (PLAN_V3 11.5): язык, режим стримера, свои плейлисты YouTube.
create table user_settings (
  user_id    uuid primary key references users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
