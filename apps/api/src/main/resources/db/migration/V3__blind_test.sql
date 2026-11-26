-- Слепой тест управления (PLAN_V2 7.0.4): анонимные оценки, без имени тестера и данных браузера.
create table blind_results (
  id            bigserial primary key,
  -- Случайный id прохода теста (генерирует клиент), чтобы считать тестеров, но не знать их
  session_id    varchar(64) not null,
  car_id        varchar(64) not null,
  label         varchar(4) not null,
  ord           int not null,
  drive_seconds int not null,
  device        varchar(16) not null,
  smooth        smallint not null check (smooth between 1 and 5),
  responsive    smallint not null check (responsive between 1 and 5),
  drift         smallint not null check (drift between 1 and 5),
  speed         smallint not null check (speed between 1 and 5),
  more          smallint not null check (more between 1 and 5),
  comment       varchar(500) not null default '',
  created_at    timestamptz not null default now(),
  unique (session_id, car_id)
);
create index blind_results_car on blind_results(car_id);
