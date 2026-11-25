package app.racer.api.ratings;

import app.racer.api.auth.TokenService;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class RatingController {
  private final RatingService ratings;

  public RatingController(RatingService ratings) {
    this.ratings = ratings;
  }

  /** Вызывает сервер гонок после финиша онлайн-гонки. */
  @PostMapping("/internal/race-results")
  public RatingService.Applied result(@RequestHeader(value = "X-Internal-Key", required = false) String key, @RequestBody RatingService.RaceResult body) throws Exception {
    return ratings.apply(key == null ? "" : key, body);
  }

  @GetMapping("/api/ratings/{cls}")
  public List<RatingService.Standing> table(@PathVariable String cls, @RequestParam(defaultValue = "50") int limit) {
    return ratings.table(cls, limit);
  }

  @GetMapping("/api/me/ratings")
  public List<Map<String, Object>> mine(Authentication auth) {
    return ratings.mine(TokenService.userId(auth));
  }
}
