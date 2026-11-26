package app.racer.api.blind;

import app.racer.api.common.ApiException;
import app.racer.api.common.RateLimiter;
import app.racer.api.garage.CarCatalog;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Слепой тест управления (PLAN_V2 7.0.4): анонимная отправка оценок и сводка по машинам.
 * Без входа в аккаунт; не больше 20 отправок в час с одного адреса.
 */
@RestController
public class BlindController {
  static final Set<String> DEVICES = Set.of("keyboard", "gamepad", "touch");
  private final JdbcTemplate db;
  private final CarCatalog cars;
  private final RateLimiter limiter = new RateLimiter(20, 3_600_000);

  public BlindController(JdbcTemplate db, CarCatalog cars) {
    this.db = db;
    this.cars = cars;
  }

  public record Submit(
      String sessionId,
      String carId,
      String label,
      int order,
      int driveSeconds,
      String device,
      Map<String, Integer> scores,
      String comment) {}

  static final List<String> QUESTIONS = List.of("smooth", "responsive", "drift", "speed", "more");

  @PostMapping("/api/blind")
  public Map<String, Object> submit(@RequestBody Submit s, HttpServletRequest req) {
    String fwd = req.getHeader("X-Forwarded-For");
    String ip = fwd != null && !fwd.isBlank() ? fwd.split(",")[0].trim() : req.getRemoteAddr();
    if (!limiter.allow(ip, System.currentTimeMillis()))
      throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited", "Слишком часто. Попробуй позже.");
    if (s.sessionId() == null || !s.sessionId().matches("[A-Za-z0-9-]{8,64}"))
      throw ApiException.bad("bad_session", "неверный id прохода");
    if (s.carId() == null || cars.car(s.carId()) == null) throw ApiException.bad("unknown_car", "нет такой машины");
    if (s.label() == null || !s.label().matches("[A-Z]{1,2}")) throw ApiException.bad("bad_label", "неверная метка");
    if (s.driveSeconds() < 30 || s.driveSeconds() > 7200) throw ApiException.bad("bad_time", "слишком короткий заезд");
    if (s.device() == null || !DEVICES.contains(s.device())) throw ApiException.bad("bad_device", "неизвестное устройство");
    if (s.scores() == null) throw ApiException.bad("bad_scores", "нужны оценки");
    int[] v = new int[QUESTIONS.size()];
    for (int i = 0; i < v.length; i++) {
      Integer x = s.scores().get(QUESTIONS.get(i));
      if (x == null || x < 1 || x > 5) throw ApiException.bad("bad_scores", "оценки 1–5 по всем вопросам");
      v[i] = x;
    }
    String comment = s.comment() == null ? "" : s.comment().trim();
    if (comment.length() > 500) comment = comment.substring(0, 500);
    int n =
        db.update(
            "insert into blind_results(session_id, car_id, label, ord, drive_seconds, device, smooth, responsive, drift, speed, more, comment) "
                + "values (?,?,?,?,?,?,?,?,?,?,?,?) on conflict (session_id, car_id) do nothing",
            s.sessionId(), s.carId(), s.label(), Math.max(0, Math.min(10, s.order())), s.driveSeconds(), s.device(),
            v[0], v[1], v[2], v[3], v[4], comment);
    return Map.of("ok", true, "duplicate", n == 0);
  }

  /** Сводка: средние по машинам и число тестеров. Цель контрольной точки 1 — ≥ 4,0 по каждому пункту. */
  @GetMapping("/api/blind/summary")
  public Map<String, Object> summary() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("testers", db.queryForObject("select count(distinct session_id) from blind_results", Integer.class));
    List<Map<String, Object>> rows =
        db.queryForList(
            "select car_id, count(*) as n, avg(smooth)::float as smooth, avg(responsive)::float as responsive, "
                + "avg(drift)::float as drift, avg(speed)::float as speed, avg(more)::float as more "
                + "from blind_results group by car_id order by car_id");
    out.put("cars", rows);
    return out;
  }
}
