package app.racer.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.racer.api.ratings.Elo;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class RatingsTest extends TestBase {
  @Test
  void eloIsZeroSumAndFavoursUpsets() {
    int[] d = Elo.deltas(new int[] {1200, 1200, 1200, 1200}, new int[] {1, 2, 3, 4});
    assertThat(d[0]).isPositive();
    assertThat(d[3]).isNegative();
    assertThat(Math.abs(d[0] + d[1] + d[2] + d[3])).isLessThanOrEqualTo(2);
    // Слабый выигрывает у сильного — получает больше, чем при равных
    int upset = Elo.deltas(new int[] {1000, 1400}, new int[] {1, 2})[0];
    int even = Elo.deltas(new int[] {1200, 1200}, new int[] {1, 2})[0];
    assertThat(upset).isGreaterThan(even);
  }

  private Map<String, Object> row(String token, int pos) throws Exception {
    var me = json(get("/api/me", token), 200);
    String car = json(get("/api/garage", token), 200).get(0).get("id").asText();
    return Map.of("userId", me.get("id").asText(), "ownedCarId", car, "position", pos, "finished", true);
  }

  @Test
  void raceResultRewardsAndRatesOnce() throws Exception {
    String a = register("e1@test.ru");
    String b = register("e2@test.ru");
    var body = Map.of("raceId", "R1", "ranked", true, "rows", List.of(row(a, 1), row(b, 2)));
    var req = post("/internal/race-results", body, null).header("X-Internal-Key", "test-internal-key");
    var res = json(req, 200);
    assertThat(res.get("replayed").asBoolean()).isFalse();
    assertThat(json(get("/api/wallet", a), 200).get("credits").asLong()).isEqualTo(20000 + 3000);
    assertThat(json(get("/api/wallet", b), 200).get("credits").asLong()).isEqualTo(20000 + 2000);
    var table = json(get("/api/ratings/D", null), 200);
    assertThat(table.get(0).get("rating").asInt()).isEqualTo(1216);
    assertThat(table.get(1).get("rating").asInt()).isEqualTo(1184);
    // Повтор того же race_id — ничего не меняется
    assertThat(json(post("/internal/race-results", body, null).header("X-Internal-Key", "test-internal-key"), 200).get("replayed").asBoolean()).isTrue();
    assertThat(json(get("/api/wallet", a), 200).get("credits").asLong()).isEqualTo(23000);
    assertThat(json(get("/api/me/ratings", a), 200).get(0).get("games").asInt()).isEqualTo(1);
  }

  @Test
  void wrongKeyIsRejectedAndUnrankedOnlyRewards() throws Exception {
    String a = register("e3@test.ru");
    String b = register("e4@test.ru");
    var body = Map.of("raceId", "R2", "ranked", false, "rows", List.of(row(a, 2), row(b, 1)));
    json(post("/internal/race-results", body, null).header("X-Internal-Key", "nope"), 403);
    json(post("/internal/race-results", body, null).header("X-Internal-Key", "test-internal-key"), 200);
    assertThat(json(get("/api/wallet", b), 200).get("credits").asLong()).isEqualTo(23000);
    assertThat(json(get("/api/ratings/D", null), 200).size()).isZero();
  }
}
