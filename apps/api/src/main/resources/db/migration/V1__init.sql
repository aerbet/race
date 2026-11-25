-- Пользователи и вход
create table users (
  id            uuid primary key,
  email         varchar(254) unique,
  password_hash varchar(100),
  telegram_id   bigint unique,
  display_name  varchar(32) not null,
  created_at    timestamptz not null default now()
);

-- Экономика: кошелёк + журнал операций (только сервер меняет баланс)
create table wallets (
  user_id uuid primary key references users(id) on delete cascade,
  credits bigint not null default 0 check (credits >= 0),
  tokens  bigint not null default 0 check (tokens >= 0),
  version bigint not null default 0
);

create table ledger (
  id              bigserial primary key,
  user_id         uuid not null references users(id) on delete cascade,
  credits_delta   bigint not null,
  tokens_delta    bigint not null,
  credits_after   bigint not null,
  tokens_after    bigint not null,
  reason          varchar(64) not null,
  ref             varchar(128),
  idempotency_key varchar(128) not null,
  created_at      timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index ledger_user_time on ledger(user_id, created_at desc);

-- Гараж
create table owned_cars (
  id         uuid primary key,
  user_id    uuid not null references users(id) on delete cascade,
  car_id     varchar(64) not null,
  parts      jsonb not null default '{}',
  visual     jsonb not null default '{}',
  pi         int not null,
  car_class  varchar(1) not null,
  created_at timestamptz not null default now()
);
create index owned_cars_user on owned_cars(user_id);

-- Рекорды (полная история; топ — в Redis)
create table records (
  id          bigserial primary key,
  user_id     uuid not null references users(id) on delete cascade,
  track_id    varchar(64) not null,
  car_class   varchar(1) not null,
  car_id      varchar(64) not null,
  lap_steps   int not null,
  verified    boolean not null default false,
  inputs      bytea,
  created_at  timestamptz not null default now()
);
create index records_track on records(track_id, car_class, lap_steps);

-- Сезоны и рейтинг Эло по классам
create table seasons (
  id        serial primary key,
  name      varchar(64) not null,
  starts_at timestamptz not null,
  ends_at   timestamptz not null
);
insert into seasons(name, starts_at, ends_at) values ('Сезон 1', '2026-11-01', '2027-01-31');

create table ratings (
  user_id   uuid not null references users(id) on delete cascade,
  season_id int not null references seasons(id),
  car_class varchar(1) not null,
  rating    int not null default 1200,
  games     int not null default 0,
  primary key (user_id, season_id, car_class)
);

-- Результаты онлайн-гонок от сервера гонок (идемпотентно по race_id)
create table race_results (
  race_id    varchar(64) primary key,
  ranked     boolean not null,
  car_class  varchar(1) not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

-- Онбординг с «Диспетчером»
create table onboarding (
  user_id    uuid primary key references users(id) on delete cascade,
  node       varchar(64) not null,
  path       jsonb not null default '[]',
  completed  boolean not null default false,
  updated_at timestamptz not null default now()
);
