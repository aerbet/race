package app.racer.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.racer.api.garage.CarCatalog;
import app.racer.api.garage.PiCalculator;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;

class GarageEconomyTest extends TestBase {
  @Autowired CarCatalog catalog;

  @Test
  void piMatchesTypeScriptFixture() throws Exception {
    JsonNode fx = om.readTree(new ClassPathResource("shared/tuning/pi-fixtures.json").getInputStream());
    assertThat(fx.size()).isGreaterThan(4);
    for (JsonNode k : fx) {
      Map<String, Integer> parts = new HashMap<>();
      k.get("parts").fields().forEachRemaining(e -> parts.put(e.getKey(), e.getValue().asInt()));
      int pi = PiCalculator.compute(catalog.car(k.get("car").asText()).config(), parts, catalog.tuning());
      assertThat(pi).as(k.toString()).isEqualTo(k.get("pi").asInt());
    }
  }

  @Test
  void upgradeChargesOnceAndRaisesPi() throws Exception {
    String t = register("c@test.ru");
    JsonNode car = json(get("/api/garage", t), 200).get(0);
    int pi0 = car.get("pi").asInt();
    String url = "/api/garage/cars/" + car.get("id").asText() + "/parts";
    var req = post(url, Map.of("category", "engine", "level", 2), t).header("Idempotency-Key", "k1");
    JsonNode up = json(req, 200);
    assertThat(up.get("pi").asInt()).isGreaterThan(pi0);
    assertThat(up.get("parts").get("engine").asInt()).isEqualTo(2);
    long after = json(get("/api/wallet", t), 200).get("credits").asLong();
    assertThat(after).isEqualTo(20000 - 14000);
    // Повтор с тем же ключом — без повторного списания
    json(post(url, Map.of("category", "engine", "level", 2), t).header("Idempotency-Key", "k1"), 200);
    assertThat(json(get("/api/wallet", t), 200).get("credits").asLong()).isEqualTo(after);
    // Ниже или равный уровень — ошибка
    json(post(url, Map.of("category", "engine", "level", 1), t).header("Idempotency-Key", "k2"), 400);
  }

  @Test
  void cannotBuyWithoutMoneyAndLedgerIsConsistent() throws Exception {
    String t = register("d@test.ru");
    json(post("/api/garage/cars", Map.of("carId", "era2026_hatch"), t).header("Idempotency-Key", "buy1"), 402);
    assertThat(json(get("/api/garage", t), 200).size()).isEqualTo(1);
    JsonNode ledger = json(get("/api/wallet/ledger", t), 200);
    assertThat(ledger.size()).isEqualTo(1);
    assertThat(ledger.get(0).get("reason").asText()).isEqualTo("welcome");
  }

  @Test
  void parallelRequestsWithSameKeyChargeOnce() throws Exception {
    String t = register("e@test.ru");
    String id = json(get("/api/garage", t), 200).get(0).get("id").asText();
    var pool = Executors.newFixedThreadPool(8);
    List<Callable<Integer>> jobs = new ArrayList<>();
    for (int i = 0; i < 8; i++)
      jobs.add(() -> mvc.perform(post("/api/garage/cars/" + id + "/parts", Map.of("category", "tires", "level", 1), t)
              .header("Idempotency-Key", "same")).andReturn().getResponse().getStatus());
    for (var f : pool.invokeAll(jobs)) assertThat(f.get()).isEqualTo(200);
    pool.shutdown();
    assertThat(json(get("/api/wallet", t), 200).get("credits").asLong()).isEqualTo(20000 - 4000);
  }

  @Test
  void visualTuningIsValidated() throws Exception {
    String t = register("f@test.ru");
    String id = json(get("/api/garage", t), 200).get(0).get("id").asText();
    var put = org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/garage/cars/" + id + "/visual")
        .header("Authorization", "Bearer " + t).contentType("application/json");
    assertThat(json(put.content("{\"paint\":\"#ff2bd6\",\"neon\":\"#29e0ff\"}"), 200).get("visual").get("paint").asText()).isEqualTo("#ff2bd6");
    json(put.content("{\"paint\":\"<script>\"}"), 400);
    json(put.content("{\"engine\":\"x\"}"), 400);
  }

  @Test
  void otherPlayersCarIsNotVisible() throws Exception {
    String a = register("g@test.ru");
    String b = register("h@test.ru");
    String id = json(get("/api/garage", a), 200).get(0).get("id").asText();
    json(post("/api/garage/cars/" + id + "/parts", Map.of("category", "engine", "level", 1), b).header("Idempotency-Key", "x"), 404);
  }
}
