package app.racer.api.ratings;

import app.racer.api.common.ApiException;
import app.racer.api.common.AppProperties;
import app.racer.api.economy.EconomyService;
import app.racer.api.garage.GarageService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Результаты онлайн-гонок от сервера гонок: награды (кредиты) и рейтинг Эло по классам машин
 * в активном сезоне. Повтор того же race_id ничего не меняет.
 */
@Service
public class RatingService {
  /** Награда за место (1-е, 2-е, 3-е, остальные финишировавшие). */
  static final long[] REWARD = {3000, 2000, 1500, 800};

  private final JdbcTemplate db;
  private final EconomyService economy;
  private final GarageService garage;
  private final ObjectMapper om;
  private final AppProperties props;

  public RatingService(JdbcTemplate db, EconomyService economy, GarageService garage, ObjectMapper om, AppProperties props) {
    this.db = db;
    this.economy = economy;
    this.garage = garage;
    this.om = om;
    this.props = props;
  }

  public record Row(UUID userId, UUID ownedCarId, int position, boolean finished) {}

  public record RaceResult(String raceId, boolean ranked, List<Row> rows) {}

  public record Applied(boolean replayed, Map<UUID, Integer> ratingDelta) {}

  public Integer activeSeason() {
    List<Integer> ids = db.queryForList("select id from seasons where now() between starts_at and ends_at order by id desc limit 1", Integer.class);
    return ids.isEmpty() ? null : ids.get(0);
  }

  @Transactional
  public Applied apply(String internalKey, RaceResult r) throws Exception {
    if (!props.internalKey().equals(internalKey)) throw new ApiException(HttpStatus.FORBIDDEN, "forbidden", "нет доступа");
    if (r.raceId() == null || r.raceId().isBlank() || r.raceId().length() > 64) throw ApiException.bad("bad_race", "нужен raceId");
    int inserted =
        db.update(
            "insert into race_results(race_id, ranked, car_class, payload) values (?, ?, ?, cast(? as jsonb)) on conflict do nothing",
            r.raceId(), r.ranked(), "-", om.writeValueAsString(r.rows()));
    if (inserted == 0) return new Applied(true, Map.of());

    // Награды
    for (Row row : r.rows()) {
      if (row.userId() == null || !row.finished()) continue;
      long reward = REWARD[Math.min(row.position(), REWARD.length) - 1];
      economy.apply(row.userId(), reward, 0, "race_reward", r.raceId(), "race:" + r.raceId());
    }

    Map<UUID, Integer> deltas = new java.util.HashMap<>();
    Integer season = activeSeason();
    if (!r.ranked() || season == null) return new Applied(false, deltas);

    // Эло: рейтинг каждого — в классе его машины
    List<Row> rated = new ArrayList<>();
    List<String> classes = new ArrayList<>();
    for (Row row : r.rows()) {
      if (row.userId() == null || row.ownedCarId() == null) continue;
      try {
        classes.add(garage.owned(row.userId(), row.ownedCarId()).carClass);
        rated.add(row);
      } catch (ApiException e) {
        // чужая или удалённая машина — не рейтингуем
      }
    }
    if (rated.size() < 2) return new Applied(false, deltas);
    int n = rated.size();
    int[] ratings = new int[n];
    int[] places = new int[n];
    for (int i = 0; i < n; i++) {
      Row row = rated.get(i);
      db.update(
          "insert into ratings(user_id, season_id, car_class) values (?, ?, ?) on conflict do nothing",
          row.userId(), season, classes.get(i));
      ratings[i] =
          db.queryForObject(
              "select rating from ratings where user_id = ? and season_id = ? and car_class = ? for update",
              Integer.class, row.userId(), season, classes.get(i));
      places[i] = row.finished() ? row.position() : 1000;
    }
    int[] d = Elo.deltas(ratings, places);
    for (int i = 0; i < n; i++) {
      db.update(
          "update ratings set rating = rating + ?, games = games + 1 where user_id = ? and season_id = ? and car_class = ?",
          d[i], rated.get(i).userId(), season, classes.get(i));
      deltas.put(rated.get(i).userId(), d[i]);
    }
    return new Applied(false, deltas);
  }

  public record Standing(int rank, UUID userId, String name, int rating, int games) {}

  public List<Standing> table(String cls, int limit) {
    Integer season = activeSeason();
    if (season == null) return List.of();
    List<Standing> out = new ArrayList<>();
    var rows =
        db.queryForList(
            "select r.user_id, u.display_name, r.rating, r.games from ratings r join users u on u.id = r.user_id "
                + "where r.season_id = ? and r.car_class = ? order by r.rating desc, r.games desc limit ?",
            season, cls, Math.min(limit, 100));
    int rank = 1;
    for (var m : rows)
      out.add(new Standing(rank++, (UUID) m.get("user_id"), (String) m.get("display_name"), (Integer) m.get("rating"), (Integer) m.get("games")));
    return out;
  }

  public List<Map<String, Object>> mine(UUID userId) {
    Integer season = activeSeason();
    if (season == null) return List.of();
    return db.queryForList("select car_class, rating, games from ratings where user_id = ? and season_id = ? order by car_class", userId, season);
  }
}
