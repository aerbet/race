package app.racer.api.payments;

import app.racer.api.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Telegram Stars (валюта XTR) через Bot API: работает в Mini App и в любом клиенте Telegram, из любой страны.
 * Счёт — createInvoiceLink (payload = id нашего платежа). Подтверждение: вебхук бота
 * (pre_checkout_query → answerPreCheckoutQuery, successful_payment), затем обязательная сверка
 * по getStarTransactions — жетоны начисляются только если транзакция с нашим payload есть у Telegram.
 * Документация: https://core.telegram.org/bots/payments-stars
 */
@Component
public class StarsProvider implements PaymentProvider {
  private final PaymentProperties props;
  private final RestClient http = Http.client();

  public StarsProvider(PaymentProperties props) {
    this.props = props;
  }

  private PaymentProperties.Stars cfg() {
    return props.stars();
  }

  @Override
  public String id() {
    return "stars";
  }

  @Override
  public boolean enabled() {
    return cfg() != null && notBlank(cfg().botToken()) && notBlank(cfg().webhookSecret());
  }

  private static boolean notBlank(String s) {
    return s != null && !s.isBlank();
  }

  @Override
  public String currency() {
    return "XTR";
  }

  @Override
  public BigDecimal price(ShopCatalog.Pack pack) {
    return BigDecimal.valueOf(pack.stars());
  }

  private String base() {
    String b = cfg().baseUrl();
    return notBlank(b) ? b : "https://api.telegram.org";
  }

  private JsonNode call(String method, Map<String, Object> body) {
    JsonNode r =
        http.post()
            .uri(base() + "/bot" + cfg().botToken() + "/" + method)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .body(JsonNode.class);
    if (r == null || !r.path("ok").asBoolean())
      throw new ApiException(HttpStatus.BAD_GATEWAY, "provider_error", "Telegram: " + (r == null ? "пустой ответ" : r.path("description").asText()));
    return r.path("result");
  }

  @Override
  public Created create(Payment p, String description, String email) {
    int stars = p.amount.intValueExact();
    JsonNode link =
        call(
            "createInvoiceLink",
            Map.of(
                "title", description,
                "description", description,
                "payload", p.id.toString(),
                "currency", "XTR",
                "prices", List.of(Map.of("label", description, "amount", stars))));
    // Ссылки на счёт у Telegram нет id — сверяем по payload (id нашего платежа)
    return new Created(p.id.toString(), link.asText());
  }

  @Override
  public Remote fetch(String ourPaymentId) {
    // Последние транзакции бота; входящая оплата — source.type = user с нашим invoice_payload
    JsonNode res = call("getStarTransactions", Map.of("offset", 0, "limit", 100));
    for (JsonNode tr : res.path("transactions")) {
      JsonNode src = tr.path("source");
      if ("user".equals(src.path("type").asText()) && ourPaymentId.equals(src.path("invoice_payload").asText()))
        return new Remote("paid", BigDecimal.valueOf(tr.path("amount").asLong()), "XTR", ourPaymentId);
    }
    return new Remote("pending", BigDecimal.ZERO, "XTR", ourPaymentId);
  }

  /** Ответ на pre_checkout_query (Telegram ждёт его не дольше 10 с). */
  public void answerPreCheckout(String queryId, boolean ok, String error) {
    if (ok) call("answerPreCheckoutQuery", Map.of("pre_checkout_query_id", queryId, "ok", true));
    else call("answerPreCheckoutQuery", Map.of("pre_checkout_query_id", queryId, "ok", false, "error_message", error));
  }

  /** Заголовок X-Telegram-Bot-Api-Secret-Token совпадает с секретом, заданным в setWebhook. */
  public boolean verifySecret(String header) {
    if (!enabled() || header == null) return false;
    return MessageDigest.isEqual(header.getBytes(StandardCharsets.UTF_8), cfg().webhookSecret().getBytes(StandardCharsets.UTF_8));
  }
}
