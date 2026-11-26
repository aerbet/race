-- Платежи: Telegram Crypto Pay и СБП (ЮKassa). Жетоны начисляются только после подтверждения провайдером.
create table payments (
  id                  uuid primary key,
  user_id             uuid not null references users(id) on delete cascade,
  provider            varchar(16) not null,
  product_id          varchar(64) not null,
  tokens              int not null,
  amount              numeric(12, 2) not null,
  currency            varchar(8) not null,
  status              varchar(16) not null default 'pending',
  provider_payment_id varchar(128),
  pay_url             text,
  idempotency_key     varchar(128) not null,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  unique (user_id, idempotency_key),
  unique (provider, provider_payment_id)
);
create index payments_user on payments(user_id, created_at desc);

-- Купленная косметика
create table owned_cosmetics (
  user_id    uuid not null references users(id) on delete cascade,
  item_id    varchar(64) not null,
  bought_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);
