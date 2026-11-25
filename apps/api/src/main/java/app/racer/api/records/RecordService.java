package app.racer.api.records;

import app.racer.api.auth.UserRepository;
import app.racer.api.common.ApiException;
import app.racer.api.garage.GarageService;
import app.racer.api.garage.OwnedCar;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Таблицы рекордов: Redis sorted set на трассу × погоду × класс, очки = время круга в шагах (меньше — лучше).
 * Время, попадающее в топ-100, принимается только с записью ввода и после повтора на сервере гонок.
 */
@Service
public class RecordService {
  public static final int TOP = 100;
  private static final int KEEP = 1000;
  static final Set<String> WEATHER = Set.of("dry", "wet", "snow");

  private final StringRedisTemplate redis;
  private final GarageService garage;
  private final ReplayVerifier verifier;
  private final RecordRepository records;
  private final UserRepository users;

  public RecordService(StringRedisTemplate redis, GarageService garage, ReplayVerifier verifier, RecordRepository records, UserRepository users) {
    this.redis = redis;
    this.garage = garage;
    this.verifier = verifier;
    this.records = records;
    this.users = users;
  }

  public static String key(String trackId, String weather, String cls) {
    return "lb:" + trackId + ":" + weather + ":" + cls;
  }

  public record Submit(String trackId, UUID ownedCarId, String weather, int laps, int lapSteps, boolean manual, String inputs) {}

  public record Accepted(boolean verified, int lapSteps, long rank, String carClass) {}

  public Accepted submit(UUID userId, Submit s) {
    if (s.trackId() == null || !s.trackId().matches("[a-z0-9_]{1,64}")) throw ApiException.bad("bad_track", "неверная трасса");
    String weather = s.weather() == null ? "dry" : s.weather();
    if (!WEATHER.contains(weather)) throw ApiException.bad("bad_weather", "неверная погода");
    if (s.lapSteps() < 600 || s.lapSteps() > 60 * 60 * 15) throw ApiException.bad("bad_time", "неправдоподобное время");
    OwnedCar car = garage.owned(userId, s.ownedCarId());
    String k = key(s.trackId(), weather, car.carClass);
    Long better = redis.opsForZSet().count(k, Double.NEGATIVE_INFINITY, s.lapSteps() - 0.5);
    boolean top = better == null || better < TOP;
    byte[] inputs = s.inputs() == null ? null : Base64.getDecoder().decode(s.inputs());
    int lap = s.lapSteps();
    boolean verified = false;
    if (top) {
      if (inputs == null || inputs.length == 0)
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "inputs_required", "для топ-100 нужна запись ввода");
      Map<String, Object> req = new HashMap<>();
      req.put("trackId", s.trackId());
      req.put("carId", car.carId);
      req.put("parts", car.parts);
      req.put("manual", s.manual());
      req.put("weather", weather);
      req.put("laps", Math.max(1, s.laps()));
      req.put("inputs", s.inputs());
      var v = verifier.verify(req);
      if (!v.ok() || !v.finished())
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "verification_failed", "заезд не воспроизводится: " + v.error());
      // Время берём из повтора, а не из заявки
      if (v.bestLapSteps() != s.lapSteps())
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "verification_failed", "время не совпадает с повтором");
      lap = v.bestLapSteps();
      verified = true;
    }
    RecordEntity r = new RecordEntity();
    r.userId = userId;
    r.trackId = s.trackId();
    r.carClass = car.carClass;
    r.carId = car.carId;
    r.lapSteps = lap;
    r.verified = verified;
    r.inputs = verified ? inputs : null;
    records.save(r);
    ZSetOperations<String, String> z = redis.opsForZSet();
    final double score = lap;
    // Лучшее время игрока: ZADD LT
    redis.execute(
        (org.springframework.data.redis.core.RedisCallback<Object>)
            conn -> conn.zSetCommands().zAdd(k.getBytes(), score, userId.toString().getBytes(),
                org.springframework.data.redis.connection.RedisZSetCommands.ZAddArgs.empty().lt()));
    redis.opsForHash().put("lbmeta:" + k, userId.toString(), car.carId);
    Long size = z.size(k);
    if (size != null && size > KEEP) z.removeRange(k, KEEP, -1);
    Long rank = z.rank(k, userId.toString());
    return new Accepted(verified, lap, rank == null ? -1 : rank + 1, car.carClass);
  }

  public record Row(long rank, String userId, String name, String carId, int lapSteps) {}

  public List<Row> board(String trackId, String weather, String cls, int limit) {
    String k = key(trackId, weather, cls);
    var set = redis.opsForZSet().rangeWithScores(k, 0, Math.min(limit, TOP) - 1L);
    List<Row> out = new ArrayList<>();
    if (set == null) return out;
    long rank = 1;
    for (var t : set) {
      String uid = t.getValue();
      String name = users.findById(UUID.fromString(uid)).map(u -> u.displayName).orElse("—");
      Object car = redis.opsForHash().get("lbmeta:" + k, uid);
      out.add(new Row(rank++, uid, name, car == null ? "" : car.toString(), t.getScore() == null ? 0 : t.getScore().intValue()));
    }
    return out;
  }
}
