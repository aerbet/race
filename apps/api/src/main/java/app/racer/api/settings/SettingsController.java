package app.racer.api.settings;

import app.racer.api.auth.TokenService;
import app.racer.api.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Настройки игрока, которые переезжают между устройствами: язык, режим стримера,
 * свои плейлисты YouTube (до 10). Музыкальные файлы игрока сюда не попадают никогда —
 * только id плейлистов YouTube и их подписи.
 */
@RestController
public class SettingsController {
  static final Pattern PLAYLIST = Pattern.compile("[A-Za-z0-9_-]{12,64}");
  static final int MAX_PLAYLISTS = 10;
  private final JdbcTemplate db;
  private final ObjectMapper om;

  public SettingsController(JdbcTemplate db, ObjectMapper om) {
    this.db = db;
    this.om = om;
  }

  @GetMapping("/api/me/settings")
  public JsonNode get(Authentication auth) throws Exception {
    List<String> rows = db.queryForList("select data::text from user_settings where user_id = ?", String.class, TokenService.userId(auth));
    return rows.isEmpty() ? om.createObjectNode() : om.readTree(rows.get(0));
  }

  /** Обновить переданные поля (остальные остаются); неизвестные поля — ошибка. */
  @PutMapping("/api/me/settings")
  @Transactional
  public JsonNode put(Authentication auth, @RequestBody JsonNode body) throws Exception {
    UUID user = TokenService.userId(auth);
    ObjectNode cur = (ObjectNode) get(auth);
    if (body == null || !body.isObject()) throw ApiException.bad("bad_value", "нужен объект настроек");
    var it = body.fields();
    while (it.hasNext()) {
      var e = it.next();
      JsonNode v = e.getValue();
      switch (e.getKey()) {
        case "lang" -> {
          if (!v.isTextual() || !List.of("ru", "en").contains(v.asText())) throw ApiException.bad("bad_value", "язык: ru или en");
          cur.set("lang", v);
        }
        case "streamer" -> {
          if (!v.isBoolean()) throw ApiException.bad("bad_value", "режим стримера: да или нет");
          cur.set("streamer", v);
        }
        case "playlists" -> cur.set("playlists", playlists(v));
        default -> throw ApiException.bad("unknown_setting", "нет такой настройки " + e.getKey());
      }
    }
    db.update(
        "insert into user_settings(user_id, data, updated_at) values (?, ?::jsonb, now()) "
            + "on conflict (user_id) do update set data = excluded.data, updated_at = now()",
        user,
        om.writeValueAsString(cur));
    return cur;
  }

  private ArrayNode playlists(JsonNode v) {
    if (!v.isArray() || v.size() > MAX_PLAYLISTS) throw ApiException.bad("bad_value", "до 10 плейлистов");
    ArrayNode out = om.createArrayNode();
    var seen = new HashSet<String>();
    for (JsonNode p : v) {
      String id = p.path("id").asText("");
      String title = p.path("title").asText(id).strip();
      if (!PLAYLIST.matcher(id).matches()) throw ApiException.bad("bad_value", "неверный id плейлиста");
      if (!seen.add(id)) continue;
      out.addObject().put("id", id).put("title", title.isEmpty() ? id : title.substring(0, Math.min(60, title.length())));
    }
    return out;
  }
}
