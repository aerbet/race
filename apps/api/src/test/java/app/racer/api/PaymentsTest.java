package app.racer.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.racer.api.payments.CryptoPayProvider;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class PaymentsTest extends TestBase {
  static final String CRYPTO_TOKEN = "123:test-crypto-token";
  static HttpServer stub;
  /** Что «провайдер» ответит на проверку статуса. */
  static final AtomicReference<String> cryptoStatus = new AtomicReference<>("active");
  static final AtomicReference<String> cryptoAmount = new AtomicReference<>("1.10");
  static final AtomicReference<String> cryptoPayload = new AtomicReference<>("");
  static final AtomicReference<String> ykStatus = new AtomicReference<>("pending");
  static final AtomicReference<String> ykAmount = new AtomicReference<>("99.00");
  static final AtomicReference<String> ykMeta = new AtomicReference<>("");
  static final AtomicReference<String> lastYkBody = new AtomicReference<>("");
  static final java.util.concurrent.atomic.AtomicInteger seq = new java.util.concurrent.atomic.AtomicInteger(1000);
  static final AtomicReference<String> lastInvoice = new AtomicReference<>("");
  static final AtomicReference<String> lastYk = new AtomicReference<>("");
  static final String BOT = "42:test-bot";
  static final String TG_SECRET = "tg-webhook-secret";
  /** Транзакции Stars, которые «видит» Telegram: payload → сумма. */
  static final Map<String, Integer> starTx = new java.util.concurrent.ConcurrentHashMap<>();
  static final AtomicReference<String> lastStarsInvoice = new AtomicReference<>("");
  static final AtomicReference<String> lastPreCheckout = new AtomicReference<>("");

  static void reply(HttpExchange ex, String json) throws IOException {
    byte[] out = json.getBytes(StandardCharsets.UTF_8);
    ex.getResponseHeaders().add("Content-Type", "application/json");
    ex.sendResponseHeaders(200, out.length);
    ex.getResponseBody().write(out);
    ex.close();
  }

  @DynamicPropertySource
  static void props(DynamicPropertyRegistry r) throws IOException {
    stub = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    stub.createContext("/api/createInvoice", ex -> {
      String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
      cryptoPayload.set(body.replaceAll(".*\"payload\":\"([^\"]+)\".*", "$1"));
      lastInvoice.set(String.valueOf(seq.incrementAndGet()));
      reply(ex, "{\"ok\":true,\"result\":{\"invoice_id\":" + lastInvoice.get() + ",\"bot_invoice_url\":\"https://t.me/CryptoBot?start=IV" + lastInvoice.get() + "\",\"status\":\"active\"}}");
    });
    stub.createContext("/api/getInvoices", ex -> {
      ex.getRequestBody().readAllBytes();
      reply(ex, "{\"ok\":true,\"result\":{\"items\":[{\"invoice_id\":" + lastInvoice.get() + ",\"status\":\"" + cryptoStatus.get() + "\",\"amount\":\"" + cryptoAmount.get()
          + "\",\"fiat\":\"USD\",\"payload\":\"" + cryptoPayload.get() + "\"}]}}");
    });
    stub.createContext("/v3/payments", ex -> {
      if (ex.getRequestMethod().equals("POST")) {
        String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        lastYkBody.set(body);
        ykMeta.set(body.replaceAll(".*\"paymentId\":\"([^\"]+)\".*", "$1"));
        lastYk.set("yk-" + seq.incrementAndGet());
        reply(ex, "{\"id\":\"" + lastYk.get() + "\",\"status\":\"pending\",\"confirmation\":{\"type\":\"redirect\",\"confirmation_url\":\"https://yoomoney.ru/sbp/" + lastYk.get() + "\"}}");
      } else {
        reply(ex, "{\"id\":\"" + lastYk.get() + "\",\"status\":\"" + ykStatus.get() + "\",\"amount\":{\"value\":\"" + ykAmount.get()
            + "\",\"currency\":\"RUB\"},\"metadata\":{\"paymentId\":\"" + ykMeta.get() + "\"}}");
      }
    });
    stub.createContext("/bot" + BOT + "/createInvoiceLink", ex -> {
      String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
      lastStarsInvoice.set(body);
      reply(ex, "{\"ok\":true,\"result\":\"https://t.me/$inv" + seq.incrementAndGet() + "\"}");
    });
    stub.createContext("/bot" + BOT + "/getStarTransactions", ex -> {
      ex.getRequestBody().readAllBytes();
      StringBuilder sb = new StringBuilder();
      starTx.forEach((payload, amount) -> sb.append(sb.isEmpty() ? "" : ",")
          .append("{\"id\":\"ch-").append(payload).append("\",\"amount\":").append(amount)
          .append(",\"date\":1,\"source\":{\"type\":\"user\",\"invoice_payload\":\"").append(payload).append("\"}}"));
      reply(ex, "{\"ok\":true,\"result\":{\"transactions\":[" + sb + "]}}");
    });
    stub.createContext("/bot" + BOT + "/answerPreCheckoutQuery", ex -> {
      lastPreCheckout.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
      reply(ex, "{\"ok\":true,\"result\":true}");
    });
    stub.start();
    String base = "http://127.0.0.1:" + stub.getAddress().getPort();
    r.add("payments.cryptopay.token", () -> CRYPTO_TOKEN);
    r.add("payments.cryptopay.base-url", () -> base);
    r.add("payments.yookassa.shop-id", () -> "100500");
    r.add("payments.yookassa.secret-key", () -> "test_secret");
    r.add("payments.yookassa.base-url", () -> base);
    r.add("payments.stars.bot-token", () -> BOT);
    r.add("payments.stars.webhook-secret", () -> TG_SECRET);
    r.add("payments.stars.base-url", () -> base);
  }

  @org.junit.jupiter.api.BeforeEach
  void resetStub() {
    cryptoStatus.set("active");
    cryptoAmount.set("1.10");
    ykStatus.set("pending");
    ykAmount.set("99.00");
  }

  @AfterAll
  static void stop() {
    stub.stop(0);
  }

  private long tokens(String t) throws Exception {
    return json(get("/api/wallet", t), 200).get("tokens").asLong();
  }

  @Test
  void productsListBothProviders() throws Exception {
    var p = json(get("/api/shop/products", null), 200);
    assertThat(p.size()).isEqualTo(3);
    assertThat(p.get(0).get("prices").get("cryptobot").get("amount").asText()).isEqualTo("1.10");
    assertThat(p.get(0).get("prices").get("sbp").get("amount").asText()).isEqualTo("99.00");
    assertThat(p.get(0).get("prices").get("stars").get("amount").asText()).isEqualTo("75");
    assertThat(p.get(0).get("prices").get("stars").get("currency").asText()).isEqualTo("XTR");
  }

  private org.springframework.test.web.servlet.RequestBuilder tgHook(String json, String secret) {
    var b = MockMvcRequestBuilders.post("/webhooks/telegram").contentType(MediaType.APPLICATION_JSON).content(json);
    return secret == null ? b : b.header("X-Telegram-Bot-Api-Secret-Token", secret);
  }

  @Test
  void starsFlow() throws Exception {
    String t = register("pay5@test.ru");
    var created = json(post("/api/payments", Map.of("productId", "tokens_100", "provider", "stars"), t).header("Idempotency-Key", "st1"), 200);
    String id = created.get("id").asText();
    assertThat(created.get("payUrl").asText()).startsWith("https://t.me/$inv");
    assertThat(created.get("currency").asText()).isEqualTo("XTR");
    assertThat(lastStarsInvoice.get()).contains("\"currency\":\"XTR\"").contains("\"payload\":\"" + id + "\"").contains("\"amount\":75");

    // Без секрета — 401
    String pre = "{\"update_id\":1,\"pre_checkout_query\":{\"id\":\"q1\",\"currency\":\"XTR\",\"total_amount\":%d,\"invoice_payload\":\"" + id + "\"}}";
    assertThat(mvc.perform(tgHook(pre.formatted(75), "wrong")).andReturn().getResponse().getStatus()).isEqualTo(401);
    // Сумма не та — отказ в pre_checkout
    mvc.perform(tgHook(pre.formatted(1), TG_SECRET));
    assertThat(lastPreCheckout.get()).contains("\"ok\":false");
    mvc.perform(tgHook(pre.formatted(75), TG_SECRET));
    assertThat(lastPreCheckout.get()).contains("\"ok\":true");

    // successful_payment без транзакции у Telegram — не начисляем
    String paidMsg = "{\"update_id\":2,\"message\":{\"message_id\":5,\"successful_payment\":{\"currency\":\"XTR\",\"total_amount\":75,\"invoice_payload\":\"" + id + "\",\"telegram_payment_charge_id\":\"ch1\"}}}";
    mvc.perform(tgHook(paidMsg, TG_SECRET));
    assertThat(tokens(t)).isZero();
    // Транзакция есть — +100, повтор — без второго начисления
    starTx.put(id, 75);
    mvc.perform(tgHook(paidMsg, TG_SECRET));
    mvc.perform(tgHook(paidMsg, TG_SECRET));
    assertThat(tokens(t)).isEqualTo(100);
    assertThat(json(get("/api/payments/" + id, t), 200).get("status").asText()).isEqualTo("paid");
    // Оплаченный счёт больше не подтверждается
    mvc.perform(tgHook(pre.formatted(75), TG_SECRET));
    assertThat(lastPreCheckout.get()).contains("\"ok\":false");
  }

  @Test
  void cryptoPayFlow() throws Exception {
    String t = register("pay1@test.ru");
    var created = json(post("/api/payments", Map.of("productId", "tokens_100", "provider", "cryptobot"), t).header("Idempotency-Key", "k1"), 200);
    assertThat(created.get("payUrl").asText()).startsWith("https://t.me/CryptoBot");
    // Повтор с тем же ключом — тот же платёж
    assertThat(json(post("/api/payments", Map.of("productId", "tokens_100", "provider", "cryptobot"), t).header("Idempotency-Key", "k1"), 200).get("id"))
        .isEqualTo(created.get("id"));

    byte[] hook = ("{\"update_id\":1,\"update_type\":\"invoice_paid\",\"payload\":{\"invoice_id\":" + lastInvoice.get() + ",\"status\":\"paid\"}}").getBytes(StandardCharsets.UTF_8);
    var webhook = MockMvcRequestBuilders.post("/webhooks/cryptobot").contentType(MediaType.APPLICATION_JSON).content(hook);
    // Подделка подписи
    assertThat(mvc.perform(webhook.header("crypto-pay-api-signature", "00ff")).andReturn().getResponse().getStatus()).isEqualTo(401);
    // Подпись верна, но провайдер говорит «не оплачено» — жетонов нет
    String sig = CryptoPayProvider.sign(hook, CRYPTO_TOKEN);
    var signed = MockMvcRequestBuilders.post("/webhooks/cryptobot").contentType(MediaType.APPLICATION_JSON).content(hook).header("crypto-pay-api-signature", sig);
    assertThat(mvc.perform(signed).andReturn().getResponse().getStatus()).isEqualTo(200);
    assertThat(tokens(t)).isZero();
    // Оплачено — +100, повторный вебхук — без второго начисления
    cryptoStatus.set("paid");
    mvc.perform(signed);
    mvc.perform(signed);
    assertThat(tokens(t)).isEqualTo(100);
    assertThat(json(get("/api/payments/" + created.get("id").asText(), t), 200).get("status").asText()).isEqualTo("paid");
    cryptoStatus.set("active");
  }

  @Test
  void sbpFlowAndAmountMismatch() throws Exception {
    // Сумма у провайдера не совпала — платёж отклоняется, жетонов нет
    String t = register("pay2@test.ru");
    var bad = json(post("/api/payments", Map.of("productId", "tokens_100", "provider", "sbp"), t).header("Idempotency-Key", "s1"), 200);
    assertThat(bad.get("payUrl").asText()).contains("sbp");
    assertThat(lastYkBody.get()).contains("\"type\":\"sbp\"");
    ykStatus.set("succeeded");
    ykAmount.set("1.00");
    mvc.perform(post("/webhooks/yookassa", Map.of("event", "payment.succeeded", "object", Map.of("id", lastYk.get())), null));
    assertThat(tokens(t)).isZero();
    assertThat(json(get("/api/payments/" + bad.get("id").asText(), t), 200).get("status").asText()).isEqualTo("failed");

    // Честная оплата: +100; повторное уведомление — без второго начисления
    String t2 = register("pay3@test.ru");
    ykStatus.set("pending");
    ykAmount.set("99.00");
    var ok = json(post("/api/payments", Map.of("productId", "tokens_100", "provider", "sbp"), t2).header("Idempotency-Key", "s2"), 200);
    var hook = post("/webhooks/yookassa", Map.of("event", "payment.succeeded", "object", Map.of("id", lastYk.get())), null);
    mvc.perform(hook);
    assertThat(tokens(t2)).isZero();
    ykStatus.set("succeeded");
    mvc.perform(hook);
    mvc.perform(hook);
    assertThat(tokens(t2)).isEqualTo(100);
    assertThat(json(get("/api/payments/" + ok.get("id").asText(), t2), 200).get("status").asText()).isEqualTo("paid");
    ykStatus.set("pending");
  }

  @Test
  void cosmeticsNeedTokensAndOwnership() throws Exception {
    String t = register("pay4@test.ru");
    String car = json(get("/api/garage", t), 200).get(0).get("id").asText();
    var put = MockMvcRequestBuilders.put("/api/garage/cars/" + car + "/visual").header("Authorization", "Bearer " + t).contentType("application/json");
    // Не куплено — нельзя
    json(put.content("{\"paint\":\"chrome\"}"), 402);
    // Без жетонов не купить
    json(post("/api/shop/cosmetics/paint_chrome/buy", Map.of(), t), 402);
    // Купили жетоны (крипта)
    cryptoStatus.set("paid");
    var created = json(post("/api/payments", Map.of("productId", "tokens_550", "provider", "cryptobot"), t).header("Idempotency-Key", "c1"), 200);
    cryptoAmount.set("5.50");
    Thread.sleep(5100);
    json(get("/api/payments/" + created.get("id").asText(), t), 200);
    assertThat(tokens(t)).isEqualTo(550);
    json(post("/api/shop/cosmetics/paint_chrome/buy", Map.of(), t), 200);
    // Повторная покупка — без повторного списания
    json(post("/api/shop/cosmetics/paint_chrome/buy", Map.of(), t), 200);
    assertThat(tokens(t)).isEqualTo(400);
    assertThat(json(put.content("{\"paint\":\"chrome\"}"), 200).get("visual").get("paint").asText()).isEqualTo("chrome");
    // Несуществующий вариант
    json(put.content("{\"paint\":\"gold_plated\"}"), 400);
    cryptoStatus.set("active");
    cryptoAmount.set("1.10");
  }
}
