package app.racer.api.payments;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Платёжные провайдеры. Ключи — только из переменных окружения; без ключей провайдер выключен.
 */
@ConfigurationProperties(prefix = "payments")
public record PaymentProperties(String publicUrl, CryptoPay cryptopay, YooKassa yookassa, Stars stars) {
  /** Telegram Crypto Pay (@CryptoBot). Тестовая сеть: https://testnet-pay.crypt.bot */
  public record CryptoPay(String token, String baseUrl, String assets) {}

  /**
   * Telegram Stars: токен бота и секрет вебхука (тот же, что передан в setWebhook как secret_token).
   * Вебхук бота: {PUBLIC_API_URL}/webhooks/telegram, allowed_updates: message, pre_checkout_query.
   */
  public record Stars(String botToken, String webhookSecret, String baseUrl) {}

  /** ЮKassa: СБП. receipts=true — отправлять чек 54-ФЗ (нужен email покупателя). */
  public record YooKassa(String shopId, String secretKey, String baseUrl, boolean receipts, int vatCode) {}
}
