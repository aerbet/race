package app.racer.api.garage;

import app.racer.api.auth.TokenService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class GarageController {
  private final GarageService garage;
  private final CarCatalog catalog;

  public GarageController(GarageService garage, CarCatalog catalog) {
    this.garage = garage;
    this.catalog = catalog;
  }

  public record CatalogCar(String id, String name, String era, long price, int pi, String carClass) {}

  @GetMapping("/api/catalog/cars")
  public List<CatalogCar> cars() {
    return catalog.cars().stream()
        .map(c -> {
          int pi = PiCalculator.compute(c.config(), Map.of(), catalog.tuning());
          return new CatalogCar(c.id(), c.name(), c.era(), c.price(), pi, PiCalculator.carClass(pi, catalog.tuning()));
        })
        .toList();
  }

  @GetMapping("/api/catalog/parts")
  public Object parts() {
    return catalog.tuning();
  }

  @GetMapping("/api/garage")
  public List<OwnedCar> list(Authentication auth) {
    return garage.list(TokenService.userId(auth));
  }

  public record BuyCar(@NotBlank String carId) {}

  @PostMapping("/api/garage/cars")
  public OwnedCar buy(Authentication auth, @RequestHeader("Idempotency-Key") String key, @Valid @RequestBody BuyCar body) {
    return garage.buy(TokenService.userId(auth), body.carId(), key);
  }

  public record Upgrade(@NotBlank String category, @Min(1) @Max(4) int level) {}

  @PostMapping("/api/garage/cars/{id}/parts")
  public OwnedCar upgrade(
      Authentication auth,
      @PathVariable UUID id,
      @RequestHeader("Idempotency-Key") String key,
      @Valid @RequestBody Upgrade body) {
    return garage.upgrade(TokenService.userId(auth), id, body.category(), body.level(), key);
  }

  @PutMapping("/api/garage/cars/{id}/visual")
  public OwnedCar visual(Authentication auth, @PathVariable UUID id, @RequestBody Map<String, String> body) {
    return garage.visual(TokenService.userId(auth), id, body);
  }
}
