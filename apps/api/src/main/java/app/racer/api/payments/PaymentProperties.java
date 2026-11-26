package app.racer.api.payments;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Платёжные провайдеры. Ключи — только из переменных окружения; без ключей провайдер выключен.
 */
@ConfigurationProperties(prefix = "payments")
public record PaymentProperties(String publicUrl, CryptoPay cryptopay, YooKassa yookassa) {
  /** Telegram Crypto Pay (@CryptoBot). Тестовая сеть: https://testnet-pay.crypt.bot */
  public record CryptoPay(String token, String baseUrl, String assets) {}

  /** ЮKassa: СБП. receipts=true — отправлять чек 54-ФЗ (нужен email покупателя). */
  public record YooKassa(String shopId, String secretKey, String baseUrl, boolean receipts, int vatCode) {}
}
