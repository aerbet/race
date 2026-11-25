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
  private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ReplayVerifier.class);
  /**
   * Только HTTP/1.1: JDK-клиент по умолчанию пробует апгрейд до h2c, а WebSocket-сервер гонок
   * перехватывает любой Upgrade и отвечает 405.
   */
  private final RestClient http =
      RestClient.builder()
          .requestFactory(
              new org.springframework.http.client.JdkClientHttpRequestFactory(
                  java.net.http.HttpClient.newBuilder()
                      .version(java.net.http.HttpClient.Version.HTTP_1_1)
                      .connectTimeout(java.time.Duration.ofSeconds(5))
                      .build()))
          .build();
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
      log.warn("сервер проверки недоступен: {}", e.toString());
      return new Verdict(false, false, 0, "verifier_unavailable");
    }
  }
}
