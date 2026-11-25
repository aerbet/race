package app.racer.api.records;

import app.racer.api.common.AppProperties;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** Повтор заезда на сервере гонок (та же физика, что у клиента) — единственный источник правды о времени. */
@Component
public class ReplayVerifier {
  private final RestClient http = RestClient.create();
  private final AppProperties props;

  public ReplayVerifier(AppProperties props) {
    this.props = props;
  }

  public record Verdict(boolean ok, boolean finished, int bestLapSteps, String error) {}

  public Verdict verify(Map<String, Object> request) {
    try {
      JsonNode r =
          http.post()
              .uri(props.verifierUrl())
              .contentType(MediaType.APPLICATION_JSON)
              .header("X-Internal-Key", props.internalKey())
              .body(request)
              .retrieve()
              .body(JsonNode.class);
      if (r == null) return new Verdict(false, false, 0, "empty");
      return new Verdict(r.path("ok").asBoolean(), r.path("finished").asBoolean(), r.path("bestLapSteps").asInt(), r.path("error").asText(null));
    } catch (Exception e) {
      return new Verdict(false, false, 0, "verifier_unavailable");
    }
  }
}
