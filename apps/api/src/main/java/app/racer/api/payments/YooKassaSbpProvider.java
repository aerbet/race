package app.racer.api.payments;

import app.racer.api.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * СБП через ЮKassa: payment_method_data.type = sbp, подтверждение — redirect на страницу с QR / выбором банка.
 * Документация: https://yookassa.ru/developers/payment-acceptance/integration-scenarios/manual-integration/other/sbp
 * Вебхукам ЮKassa без подписи не верим: статус и сумму всегда перепроверяем запросом GET /v3/payments/{id}.
 */
@Component
public class YooKassaSbpProvider implements PaymentProvider {
  private final PaymentProperties props;
  private final RestClient http = Http.client();

  public YooKassaSbpProvider(PaymentProperties props) {
    this.props = props;
  }

  private PaymentProperties.YooKassa cfg() {
    return props.yookassa();
  }

  @Override
  public String id() {
    return "sbp";
  }

  @Override
  public boolean enabled() {
    return cfg() != null && cfg().shopId() != null && !cfg().shopId().isBlank() && cfg().secretKey() != null && !cfg().secretKey().isBlank();
  }

  @Override
  public String currency() {
    return "RUB";
  }

  @Override
  public BigDecimal price(ShopCatalog.Pack pack) {
    return pack.rub().setScale(2, RoundingMode.HALF_UP);
  }

  private String base() {
    String b = cfg().baseUrl();
    return b == null || b.isBlank() ? "https://api.yookassa.ru" : b;
  }

  private String auth() {
    return "Basic " + Base64.getEncoder().encodeToString((cfg().shopId() + ":" + cfg().secretKey()).getBytes(StandardCharsets.UTF_8));
  }

  @Override
  public Created create(Payment p, String description, String email) {
    Map<String, Object> amount = Map.of("value", p.amount.toPlainString(), "currency", "RUB");
    Map<String, Object> body = new HashMap<>();
    body.put("amount", amount);
    body.put("capture", true);
    body.put("payment_method_data", Map.of("type", "sbp"));
    String ret = (props.publicUrl() == null ? "" : props.publicUrl()) + "/?payment=" + p.id;
    body.put("confirmation", Map.of("type", "redirect", "return_url", ret));
    body.put("description", description);
    body.put("metadata", Map.of("paymentId", p.id.toString()));
    if (cfg().receipts()) {
      if (email == null || email.isBlank())
        throw ApiException.bad("email_required", "для чека нужен email в аккаунте");
      body.put(
          "receipt",
          Map.of(
              "customer", Map.of("email", email),
              "items",
              List.of(
                  Map.of(
                      "description", description,
                      "quantity", "1.00",
                      "amount", amount,
                      "vat_code", cfg().vatCode() == 0 ? 1 : cfg().vatCode(),
                      "payment_mode", "full_payment",
                      "payment_subject", "service"))));
    }
    JsonNode r =
        http.post()
            .uri(base() + "/v3/payments")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", auth())
            .header("Idempotence-Key", p.id.toString())
            .body(body)
            .retrieve()
            .body(JsonNode.class);
    if (r == null || r.path("id").asText("").isEmpty())
      throw new ApiException(HttpStatus.BAD_GATEWAY, "provider_error", "ЮKassa: платёж не создан");
    return new Created(r.path("id").asText(), r.path("confirmation").path("confirmation_url").asText(""));
  }

  @Override
  public Remote fetch(String providerPaymentId) {
    JsonNode r =
        http.get()
            .uri(base() + "/v3/payments/" + providerPaymentId)
            .header("Authorization", auth())
            .retrieve()
            .body(JsonNode.class);
    if (r == null) throw new ApiException(HttpStatus.BAD_GATEWAY, "provider_error", "ЮKassa: пустой ответ");
    String status = switch (r.path("status").asText("")) {
      case "succeeded" -> "paid";
      case "canceled" -> "failed";
      default -> "pending";
    };
    return new Remote(
        status,
        new BigDecimal(r.path("amount").path("value").asText("0")),
        r.path("amount").path("currency").asText("RUB"),
        r.path("metadata").path("paymentId").asText(""));
  }
}
