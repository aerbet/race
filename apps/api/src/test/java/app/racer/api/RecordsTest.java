package app.racer.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.racer.api.records.RecordService;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

class RecordsTest extends TestBase {
  /** Заглушка сервера гонок: отвечает заданным временем повтора и считает вызовы. */
  static final AtomicInteger replayTime = new AtomicInteger();
  static final AtomicInteger calls = new AtomicInteger();
  static final AtomicReference<String> lastKey = new AtomicReference<>();
  static HttpServer stub;

  @DynamicPropertySource
  static void props(DynamicPropertyRegistry r) throws IOException {
    stub = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    stub.createContext("/verify", ex -> {
      calls.incrementAndGet();
      lastKey.set(ex.getRequestHeaders().getFirst("X-Internal-Key"));
      ex.getRequestBody().readAllBytes();
      byte[] out = ("{\"ok\":true,\"finished\":true,\"bestLapSteps\":" + replayTime.get() + "}").getBytes(StandardCharsets.UTF_8);
      ex.getResponseHeaders().add("Content-Type", "application/json");
      ex.sendResponseHeaders(200, out.length);
      ex.getResponseBody().write(out);
      ex.close();
    });
    stub.start();
    r.add("app.verifier-url", () -> "http://127.0.0.1:" + stub.getAddress().getPort() + "/verify");
  }

  @AfterAll
  static void stop() {
    stub.stop(0);
  }

  @Autowired StringRedisTemplate redis;

  private Map<String, Object> claim(String carId, int lap, String inputs) {
    Map<String, Object> m = new HashMap<>();
    m.put("trackId", "polygon");
    m.put("ownedCarId", carId);
    m.put("weather", "dry");
    m.put("laps", 1);
    m.put("lapSteps", lap);
    m.put("manual", false);
    if (inputs != null) m.put("inputs", inputs);
    return m;
  }

  @Test
  void topRecordNeedsInputsAndReplayMatch() throws Exception {
    String t = register("r1@test.ru");
    String car = json(get("/api/garage", t), 200).get(0).get("id").asText();
    // Без записи ввода в топ-100 не пускаем
    assertThat(json(post("/api/records", claim(car, 5000, null), t), 422).get("error").asText()).isEqualTo("inputs_required");
    // Повтор дал другое время — отказ
    replayTime.set(5100);
    assertThat(json(post("/api/records", claim(car, 5000, "AAAAAAAA"), t), 422).get("error").asText()).isEqualTo("verification_failed");
    // Совпало — принято, ранг 1
    replayTime.set(5000);
    var ok = json(post("/api/records", claim(car, 5000, "AAAAAAAA"), t), 200);
    assertThat(ok.get("verified").asBoolean()).isTrue();
    assertThat(ok.get("rank").asLong()).isEqualTo(1);
    assertThat(lastKey.get()).isEqualTo("test-internal-key");
    var board = json(get("/api/records/polygon?weather=dry&class=D", null), 200);
    assertThat(board.get(0).get("name").asText()).isEqualTo("Тест");
    assertThat(board.get(0).get("lapSteps").asInt()).isEqualTo(5000);
  }

  @Test
  void worseTimeKeepsPersonalBest() throws Exception {
    String t = register("r2@test.ru");
    String car = json(get("/api/garage", t), 200).get(0).get("id").asText();
    replayTime.set(4800);
    json(post("/api/records", claim(car, 4800, "AAAAAAAA"), t), 200);
    replayTime.set(5200);
    json(post("/api/records", claim(car, 5200, "AAAAAAAA"), t), 200);
    var board = json(get("/api/records/polygon?class=D", null), 200);
    assertThat(board.size()).isEqualTo(1);
    assertThat(board.get(0).get("lapSteps").asInt()).isEqualTo(4800);
  }

  @Test
  void outsideTop100IsAcceptedWithoutReplay() throws Exception {
    String t = register("r3@test.ru");
    String car = json(get("/api/garage", t), 200).get(0).get("id").asText();
    String k = RecordService.key("polygon", "dry", "D");
    for (int i = 0; i < 100; i++) redis.opsForZSet().add(k, "00000000-0000-0000-0000-" + String.format("%012d", i), 3000 + i);
    int before = calls.get();
    var ok = json(post("/api/records", claim(car, 9000, null), t), 200);
    assertThat(ok.get("verified").asBoolean()).isFalse();
    assertThat(ok.get("rank").asLong()).isEqualTo(101);
    assertThat(calls.get()).isEqualTo(before);
  }

  @Test
  void cannotSubmitWithSomeoneElsesCar() throws Exception {
    String a = register("r4@test.ru");
    String b = register("r5@test.ru");
    String car = json(get("/api/garage", a), 200).get(0).get("id").asText();
    json(post("/api/records", claim(car, 5000, "AAAAAAAA"), b), 404);
  }
}
