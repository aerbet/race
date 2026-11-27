package app.racer.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class SettingsTest extends TestBase {
  private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder put(String t, String json) {
    return MockMvcRequestBuilders.put("/api/me/settings").header("Authorization", "Bearer " + t).contentType("application/json").content(json);
  }

  @Test
  void settingsFollowTheAccount() throws Exception {
    String t = register("set1@test.ru");
    assertThat(json(get("/api/me/settings", t), 200).size()).isZero();
    json(put(t, "{\"lang\":\"en\",\"streamer\":true}"), 200);
    var pl = "[{\"id\":\"PLDE0DBBFAA8E2F771\",\"title\":\"Ночь\"},{\"id\":\"PLDE0DBBFAA8E2F771\",\"title\":\"дубль\"}]";
    var r = json(put(t, "{\"playlists\":" + pl + "}"), 200);
    // Частичное обновление не стирает остальное, дубли убраны
    assertThat(r.get("lang").asText()).isEqualTo("en");
    assertThat(r.get("streamer").asBoolean()).isTrue();
    assertThat(r.get("playlists").size()).isEqualTo(1);
    assertThat(json(get("/api/me/settings", t), 200).get("playlists").get(0).get("title").asText()).isEqualTo("Ночь");
    // Чужой аккаунт — свои настройки
    assertThat(json(get("/api/me/settings", register("set2@test.ru")), 200).size()).isZero();
  }

  @Test
  void settingsAreValidated() throws Exception {
    String t = register("set3@test.ru");
    json(put(t, "{\"lang\":\"de\"}"), 400);
    json(put(t, "{\"streamer\":\"yes\"}"), 400);
    json(put(t, "{\"playlists\":[{\"id\":\"<script>\"}]}"), 400);
    json(put(t, "{\"musicFile\":\"track.mp3\"}"), 400);
    StringBuilder many = new StringBuilder("[");
    for (int i = 0; i < 11; i++) many.append(i == 0 ? "" : ",").append("{\"id\":\"PLtest").append(String.format("%010d", i)).append("\"}");
    json(put(t, "{\"playlists\":" + many + "]}"), 400);
    // Без входа — нельзя
    json(get("/api/me/settings", null), 401);
  }
}
