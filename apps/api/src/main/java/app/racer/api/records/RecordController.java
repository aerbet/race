package app.racer.api.records;

import app.racer.api.auth.TokenService;
import java.util.List;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class RecordController {
  private final RecordService records;

  public RecordController(RecordService records) {
    this.records = records;
  }

  @PostMapping("/api/records")
  public RecordService.Accepted submit(Authentication auth, @RequestBody RecordService.Submit body) {
    return records.submit(TokenService.userId(auth), body);
  }

  @GetMapping("/api/records/{trackId}")
  public List<RecordService.Row> board(
      @PathVariable String trackId,
      @RequestParam(defaultValue = "dry") String weather,
      @RequestParam(name = "class", defaultValue = "D") String cls,
      @RequestParam(defaultValue = "100") int limit) {
    return records.board(trackId, weather, cls, limit);
  }
}
