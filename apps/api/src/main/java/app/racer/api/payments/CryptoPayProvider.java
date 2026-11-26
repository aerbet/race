package app.racer.api.payments;

import app.racer.api.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Telegram Crypto Pay (@CryptoBot): счёт в долларах, оплата USDT/TON прямо в Telegram.
 * Документация: https://help.crypt.bot/crypto-pay-api
 */
@Component
public class CryptoPayProvider implements PaymentProvider {
  private final PaymentProperties props;
  private final RestClient http = Http.client();

  public CryptoPayProvider(PaymentProperties props) {
    this.props = props;
  }

  private PaymentProperties.CryptoPay cfg() {
    return props.cryptopay();
  }

  @Override
  public String id() {
    return "cryptobot";
  }

  @Override
  public boolean enabled() {
    return cfg() != null && cfg().token() != null && !cfg().token().isBlank();
  }

  @Override
  public String currency() {
    return "USD";
  }

  @Override
  public BigDecimal price(ShopCatalog.Pack pack) {
    return pack.usdt().setScale(2, RoundingMode.HALF_UP);
  }

  private String base() {
    String b = cfg().baseUrl();
    return b == null || b.isBlank() ? "https://pay.crypt.bot" : b;
  }

  private JsonNode call(String method, Map<String, Object> body) {
    JsonNode r =
        http.post()
            .uri(base() + "/api/" + method)
            .contentType(MediaType.APPLICATION_JSON)
            .header("Crypto-Pay-API-Token", cfg().token())
            .body(body)
            .retrieve()
            .body(JsonNode.class);
    if (r == null || !r.path("ok").asBoolean())
      throw new ApiException(HttpStatus.BAD_GATEWAY, "provider_error", "Crypto Pay: " + (r == null ? "пустой ответ" : r.path("error").toString()));
    return r.path("result");
  }

  @Override
  public Created create(Payment p, String description, String email) {
    Map<String, Object> body = new HashMap<>();
    body.put("currency_type", "fiat");
    body.put("fiat", "USD");
    body.put("amount", p.amount.toPlainString());
    body.put("accepted_assets", cfg().assets() == null || cfg().assets().isBlank() ? "USDT,TON" : cfg().assets());
    body.put("description", description);
    body.put("payload", p.id.toString());
    body.put("expires_in", 3600);
    if (props.publicUrl() != null && !props.publicUrl().isBlank()) {
      body.put("paid_btn_name", "callback");
      body.put("paid_btn_url", props.publicUrl() + "/?payment=" + p.id);
    }
    JsonNode inv = call("createInvoice", body);
    String url = inv.path("bot_invoice_url").asText(inv.path("pay_url").asText(""));
    return new Created(inv.path("invoice_id").asText(), url);
  }

  @Override
  public Remote fetch(String providerPaymentId) {
    JsonNode res = call("getInvoices", Map.of("invoice_ids", providerPaymentId));
    JsonNode inv = res.path("items").path(0);
    String st = inv.path("status").asText("");
    String status = switch (st) {
      case "paid" -> "paid";
      case "expired" -> "expired";
      case "active" -> "pending";
      default -> "failed";
    };
    String amount = inv.path("amount").asText("0");
    return new Remote(status, new BigDecimal(amount), inv.path("fiat").asText("USD"), inv.path("payload").asText(""));
  }

  /** Подпись вебхука: hex(HMAC-SHA256(тело, ключ = SHA256(токен))). */
  public boolean verifySignature(byte[] body, String signature) {
    if (!enabled() || signature == null) return false;
    try {
      byte[] key = MessageDigest.getInstance("SHA-256").digest(cfg().token().getBytes(StandardCharsets.UTF_8));
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      String expected = HexFormat.of().formatHex(mac.doFinal(body));
      return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), signature.toLowerCase().getBytes(StandardCharsets.UTF_8));
    } catch (Exception e) {
      return false;
    }
  }

  /** Подпись для тестов. */
  public static String sign(byte[] body, String token) throws Exception {
    byte[] key = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(key, "HmacSHA256"));
    return HexFormat.of().formatHex(mac.doFinal(body));
  }
}
