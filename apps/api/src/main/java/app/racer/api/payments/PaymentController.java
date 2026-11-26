package app.racer.api.payments;

import app.racer.api.auth.TokenService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PaymentController {
  private static final Logger log = LoggerFactory.getLogger(PaymentController.class);
  private final PaymentService payments;
  private final CryptoPayProvider cryptoPay;
  private final StarsProvider stars;
  private final ObjectMapper om;

  public PaymentController(PaymentService payments, CryptoPayProvider cryptoPay, StarsProvider stars, ObjectMapper om) {
    this.payments = payments;
    this.cryptoPay = cryptoPay;
    this.stars = stars;
    this.om = om;
  }

  @GetMapping("/api/shop/products")
  public List<PaymentService.Offer> products() {
    return payments.offers();
  }

  public record Create(String productId, String provider) {}

  public record View(UUID id, String status, String provider, String productId, int tokens, String amount, String currency, String payUrl) {
    static View of(Payment p) {
      return new View(p.id, p.status, p.provider, p.productId, p.tokens, p.amount.toPlainString(), p.currency, p.payUrl);
    }
  }

  @PostMapping("/api/payments")
  public View create(Authentication auth, @RequestHeader("Idempotency-Key") String key, @RequestBody Create body) {
    return View.of(payments.create(TokenService.userId(auth), body.productId(), body.provider(), key));
  }

  @GetMapping("/api/payments/{id}")
  public View status(Authentication auth, @PathVariable UUID id) {
    return View.of(payments.status(TokenService.userId(auth), id));
  }

  @GetMapping("/api/payments")
  public List<View> history(Authentication auth) {
    return payments.history(TokenService.userId(auth)).stream().map(View::of).toList();
  }

  /** Вебхук Crypto Pay: подпись по сырому телу; оплату всё равно перепроверяем getInvoices. */
  @PostMapping("/webhooks/cryptobot")
  public ResponseEntity<String> cryptobot(@RequestHeader(value = "crypto-pay-api-signature", required = false) String sig, @RequestBody byte[] body) {
    if (!cryptoPay.verifySignature(body, sig)) return ResponseEntity.status(401).body("bad signature");
    try {
      JsonNode u = om.readTree(body);
      if ("invoice_paid".equals(u.path("update_type").asText())) {
        String invoiceId = u.path("payload").path("invoice_id").asText();
        Payment p = payments.byProvider("cryptobot", invoiceId);
        if (p != null) payments.confirm(p.id);
      }
    } catch (Exception e) {
      log.warn("вебхук Crypto Pay: {}", e.toString());
      return ResponseEntity.status(500).body("retry");
    }
    return ResponseEntity.ok("ok");
  }

  /**
   * Вебхук бота (Telegram Stars). Подлинность — секрет из setWebhook в заголовке.
   * pre_checkout_query: подтверждаем, только если платёж наш, ждёт оплаты и сумма совпала.
   * successful_payment: телу не верим — confirm() сверяет транзакцию через getStarTransactions.
   */
  @PostMapping("/webhooks/telegram")
  public ResponseEntity<String> telegram(@RequestHeader(value = "X-Telegram-Bot-Api-Secret-Token", required = false) String secret, @RequestBody byte[] body) {
    if (!stars.verifySecret(secret)) return ResponseEntity.status(401).body("bad secret");
    try {
      JsonNode u = om.readTree(body);
      JsonNode q = u.path("pre_checkout_query");
      if (!q.isMissingNode()) {
        Payment p = payments.byProvider("stars", q.path("invoice_payload").asText());
        boolean ok = p != null && "pending".equals(p.status) && "XTR".equals(q.path("currency").asText())
            && p.amount.longValue() == q.path("total_amount").asLong();
        stars.answerPreCheckout(q.path("id").asText(), ok, ok ? null : "Счёт устарел. Открой магазин ещё раз.");
      }
      JsonNode paid = u.path("message").path("successful_payment");
      if (!paid.isMissingNode()) {
        Payment p = payments.byProvider("stars", paid.path("invoice_payload").asText());
        if (p != null) payments.confirm(p.id);
      }
    } catch (Exception e) {
      log.warn("вебхук Telegram: {}", e.toString());
      return ResponseEntity.status(500).body("retry");
    }
    return ResponseEntity.ok("ok");
  }

  /** Уведомления ЮKassa: телу не верим, статус и сумму перепроверяем GET /v3/payments/{id}. */
  @PostMapping("/webhooks/yookassa")
  public ResponseEntity<String> yookassa(@RequestBody Map<String, Object> body) {
    try {
      Object obj = body.get("object");
      if (obj instanceof Map<?, ?> m && m.get("id") != null) {
        Payment p = payments.byProvider("sbp", String.valueOf(m.get("id")));
        if (p != null) payments.confirm(p.id);
      }
    } catch (Exception e) {
      log.warn("уведомление ЮKassa: {}", e.toString());
      return ResponseEntity.status(500).body("retry");
    }
    return ResponseEntity.ok("ok");
  }
}
