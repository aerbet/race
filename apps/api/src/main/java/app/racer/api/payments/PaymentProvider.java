package app.racer.api.payments;

import java.math.BigDecimal;

/** Платёжный провайдер (Telegram Crypto Pay, СБП через ЮKassa; другого можно добавить реализацией). */
public interface PaymentProvider {
  /** cryptobot | sbp */
  String id();

  boolean enabled();

  /** Валюта цены у этого провайдера: USD (крипта, расчёт в USDT/TON) или RUB. */
  String currency();

  BigDecimal price(ShopCatalog.Pack pack);

  record Created(String providerPaymentId, String payUrl) {}

  Created create(Payment p, String description, String customerEmail);

  /** Состояние у провайдера: paid | pending | failed | expired, и сумма для сверки. */
  record Remote(String status, BigDecimal amount, String currency, String ourPaymentId) {}

  Remote fetch(String providerPaymentId);
}
