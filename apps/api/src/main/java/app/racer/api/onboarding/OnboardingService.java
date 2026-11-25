package app.racer.api.onboarding;

import app.racer.api.common.ApiException;
import app.racer.api.economy.EconomyService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Онбординг с «Диспетчером»: сценарий — тот же JSON, что рисует клиент (packages/shared/src/story).
 * Сервер проверяет переходы и один раз выдаёт награду в конце.
 */
@Service
public class OnboardingService {
  private final JsonNode story;
  private final JdbcTemplate db;
  private final EconomyService economy;
  private final ObjectMapper om;

  public OnboardingService(ObjectMapper om, JdbcTemplate db, EconomyService economy) throws IOException {
    try (InputStream in = new ClassPathResource("shared/story/dispatcher.json").getInputStream()) {
      this.story = om.readTree(in);
    }
    this.db = db;
    this.economy = economy;
    this.om = om;
  }

  public record State(String node, boolean completed, List<String> path) {}

  public State state(UUID userId) {
    var rows = db.queryForList("select node, completed, path::text as path from onboarding where user_id = ?", userId);
    if (rows.isEmpty()) return new State(story.path("start").asText(), false, List.of());
    var r = rows.get(0);
    try {
      List<String> path = om.readValue((String) r.get("path"), om.getTypeFactory().constructCollectionType(List.class, String.class));
      return new State((String) r.get("node"), (Boolean) r.get("completed"), path);
    } catch (IOException e) {
      return new State((String) r.get("node"), (Boolean) r.get("completed"), List.of());
    }
  }

  @Transactional
  public State choose(UUID userId, String node, int choice) throws IOException {
    State s = state(userId);
    if (s.completed()) return s;
    if (!s.node().equals(node)) throw ApiException.bad("wrong_node", "ожидался узел " + s.node());
    JsonNode c = story.path("nodes").path(node).path("choices").path(choice);
    if (c.isMissingNode()) throw ApiException.bad("bad_choice", "нет такого ответа");
    String next = c.path("next").asText();
    boolean end = story.path("nodes").path(next).path("end").asBoolean(false);
    List<String> path = new java.util.ArrayList<>(s.path());
    path.add(node + ":" + choice);
    db.update(
        "insert into onboarding(user_id, node, path, completed, updated_at) values (?, ?, cast(? as jsonb), ?, now()) "
            + "on conflict (user_id) do update set node = excluded.node, path = excluded.path, completed = excluded.completed, updated_at = now()",
        userId, next, om.writeValueAsString(path), end);
    if (end) economy.apply(userId, story.path("reward").asLong(0), 0, "onboarding", story.path("id").asText(), "onboarding");
    return new State(next, end, path);
  }

  public Map<String, Object> story() {
    return om.convertValue(story, Map.class);
  }
}
