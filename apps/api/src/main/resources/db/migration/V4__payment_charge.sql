-- Telegram Stars (PLAN_V3 11.4): id списания и сумма из successful_payment.
-- Подтверждение оплаты больше не зависит от порядка getStarTransactions.
alter table payments add column charge_id varchar(128);
alter table payments add column charge_amount numeric(12, 2);
create unique index payments_charge_id on payments (provider, charge_id) where charge_id is not null;
