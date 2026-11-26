package app.racer.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class BlindTest extends TestBase {
  private Map<String, Object> result(String session, String car, int score) {
    Map<String, Object> m = new HashMap<>();
    m.put("sessionId", session);
    m.put("carId", car);
    m.put("label", "A");
    m.put("order", 0);
    m.put("driveSeconds", 95);
    m.put("device", "keyboard");
    m.put("scores", Map.of("smooth", score, "responsive", score, "drift", score, "speed", score, "more", score));
    m.put("comment", "норм");
    return m;
  }

  @Test
  void anonymousSubmitAndSummary() throws Exception {
    json(post("/api/blind", result("tester-aaaa-1111", "era2000_coupe", 4), null), 200);
    json(post("/api/blind", result("tester-bbbb-2222", "era2000_coupe", 5), null), 200);
    // Повтор того же прохода по той же машине — не дублируется
    assertThat(json(post("/api/blind", result("tester-bbbb-2222", "era2000_coupe", 1), null), 200).get("duplicate").asBoolean()).isTrue();
    var s = json(get("/api/blind/summary", null), 200);
    assertThat(s.get("testers").asInt()).isEqualTo(2);
    assertThat(s.get("cars").get(0).get("smooth").asDouble()).isEqualTo(4.5);
  }

  @Test
  void rejectsBadInput() throws Exception {
    var bad = result("tester-cccc-3333", "era2000_coupe", 6);
    json(post("/api/blind", bad, null), 400);
    var shortRide = result("tester-cccc-3333", "era2000_coupe", 3);
    shortRide.put("driveSeconds", 5);
    json(post("/api/blind", shortRide, null), 400);
    json(post("/api/blind", result("x", "era2000_coupe", 3), null), 400);
    json(post("/api/blind", result("tester-cccc-3333", "real_car_911", 3), null), 400);
  }
}
