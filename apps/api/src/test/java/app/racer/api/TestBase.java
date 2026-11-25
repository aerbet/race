package app.racer.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/** Интеграционные тесты на настоящих PostgreSQL (racer_test) и Redis (база 1). */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public abstract class TestBase {
  @Autowired protected MockMvc mvc;
  @Autowired protected ObjectMapper om;
  @Autowired private Flyway flyway;
  @Autowired private StringRedisTemplate redis;

  @BeforeEach
  void cleanDb() {
    flyway.clean();
    flyway.migrate();
    var keys = redis.keys("*");
    if (keys != null && !keys.isEmpty()) redis.delete(keys);
  }

  protected JsonNode json(MockHttpServletRequestBuilder req, int status) throws Exception {
    var res = mvc.perform(req).andReturn().getResponse();
    if (res.getStatus() != status)
      throw new AssertionError("ожидали " + status + ", пришло " + res.getStatus() + ": " + res.getContentAsString());
    String body = res.getContentAsString();
    return body.isEmpty() ? om.nullNode() : om.readTree(body);
  }

  protected MockHttpServletRequestBuilder post(String url, Object body, String token) throws Exception {
    var r = MockMvcRequestBuilders.post(url).contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body));
    return token == null ? r : r.header("Authorization", "Bearer " + token);
  }

  protected MockHttpServletRequestBuilder get(String url, String token) {
    var r = MockMvcRequestBuilders.get(url);
    return token == null ? r : r.header("Authorization", "Bearer " + token);
  }

  protected String register(String email) throws Exception {
    return json(post("/api/auth/register", java.util.Map.of("email", email, "password", "password123", "name", "Тест"), null), 200)
        .get("token")
        .asText();
  }
}
