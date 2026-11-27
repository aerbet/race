package app.racer.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.racer.api.auth.TelegramVerifier;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AuthTest extends TestBase {
  @Test
  void registerGivesTokenWalletAndFirstCar() throws Exception {
    String t = register("a@test.ru");
    assertThat(json(get("/api/me", t), 200).get("email").asText()).isEqualTo("a@test.ru");
    assertThat(json(get("/api/wallet", t), 200).get("credits").asLong()).isEqualTo(20000);
    var garage = json(get("/api/garage", t), 200);
    assertThat(garage.size()).isEqualTo(1);
    assertThat(garage.get(0).get("carId").asText()).isEqualTo("era2000_coupe");
    assertThat(garage.get(0).get("carClass").asText()).isEqualTo("D");
  }

  @Test
  void duplicateEmailAndBadPassword() throws Exception {
    register("b@test.ru");
    json(post("/api/auth/register", Map.of("email", "B@test.ru", "password", "password123", "name", "Тест"), null), 409);
    json(post("/api/auth/login", Map.of("email", "b@test.ru", "password", "wrong-pass"), null), 401);
    assertThat(json(post("/api/auth/login", Map.of("email", "b@test.ru", "password", "password123"), null), 200).has("token")).isTrue();
  }

  @Test
  void protectedEndpointsNeedToken() throws Exception {
    json(get("/api/wallet", null), 401);
    json(get("/api/wallet", "garbage"), 401);
  }

  @Test
  void telegramLoginChecksSignature() throws Exception {
    Map<String, String> data = new HashMap<>();
    data.put("id", "424242");
    data.put("first_name", "Аня");
    data.put("username", "anya_racer");
    data.put("auth_date", String.valueOf(Instant.now().getEpochSecond()));
    data.put("hash", TelegramVerifier.sign(data, "test-bot-token"));
    var ok = json(post("/api/auth/telegram", data, null), 200);
    assertThat(ok.get("name").asText()).isEqualTo("anya_racer");
    // Повторный вход — тот же пользователь
    assertThat(json(post("/api/auth/telegram", data, null), 200).get("userId")).isEqualTo(ok.get("userId"));
    data.put("first_name", "Подделка");
    json(post("/api/auth/telegram", data, null), 401);
  }

  @Test
  void telegramMiniAppLogin() throws Exception {
    Map<String, String> f = new java.util.LinkedHashMap<>();
    f.put("query_id", "AAHdF6IQAAAAAN0XohDhrOrc");
    f.put("user", "{\"id\":515151,\"first_name\":\"Кира\",\"username\":\"kira_drift\",\"language_code\":\"ru\"}");
    f.put("auth_date", String.valueOf(Instant.now().getEpochSecond()));
    String initData = TelegramVerifier.signWebApp(f, "test-bot-token");
    var ok = json(post("/api/auth/telegram-webapp", Map.of("initData", initData), null), 200);
    assertThat(ok.get("name").asText()).isEqualTo("kira_drift");
    assertThat(json(post("/api/auth/telegram-webapp", Map.of("initData", initData), null), 200).get("userId")).isEqualTo(ok.get("userId"));
    // Подпись виджета входа (другой ключ) или подмена данных — отказ
    json(post("/api/auth/telegram-webapp", Map.of("initData", initData.replace("515151", "515152")), null), 401);
    json(post("/api/auth/telegram-webapp", Map.of("initData", TelegramVerifier.signWebApp(f, "other-bot")), null), 401);
    // Устаревшие данные — отказ
    f.put("auth_date", String.valueOf(Instant.now().getEpochSecond() - 90000));
    json(post("/api/auth/telegram-webapp", Map.of("initData", TelegramVerifier.signWebApp(f, "test-bot-token")), null), 401);
  }
}
