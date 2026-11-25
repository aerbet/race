package app.racer.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

class OnboardingTest extends TestBase {
  @Test
  void walkThroughDialogGetsRewardOnce() throws Exception {
    String t = register("o1@test.ru");
    assertThat(json(get("/api/onboarding", t), 200).get("node").asText()).isEqualTo("hello");
    // Неверный узел и неверный выбор
    json(post("/api/onboarding", Map.of("node", "garage", "choice", 0), t), 400);
    json(post("/api/onboarding", Map.of("node", "hello", "choice", 9), t), 400);
    String[][] path = {{"hello", "1"}, {"cocky", "0"}, {"garage", "0"}, {"reward", "0"}};
    var last = om.nullNode();
    for (String[] p : path) last = json(post("/api/onboarding", Map.of("node", p[0], "choice", Integer.parseInt(p[1])), t), 200);
    assertThat(last.get("completed").asBoolean()).isTrue();
    assertThat(json(get("/api/wallet", t), 200).get("credits").asLong()).isEqualTo(25000);
    // Повтор — без второй награды
    json(post("/api/onboarding", Map.of("node", "reward", "choice", 0), t), 200);
    assertThat(json(get("/api/wallet", t), 200).get("credits").asLong()).isEqualTo(25000);
  }
}
