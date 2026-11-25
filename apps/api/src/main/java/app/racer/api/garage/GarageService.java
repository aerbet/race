package app.racer.api.garage;

import app.racer.api.common.ApiException;
import app.racer.api.economy.EconomyService;
import app.racer.api.economy.LedgerRepository;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GarageService {
  private final CarCatalog catalog;
  private final OwnedCarRepository cars;
  private final EconomyService economy;
  private final LedgerRepository ledger;

  /** Разрешённые визуальные слоты и формат значений (цвет #rrggbb или id варианта). */
  static final Map<String, Pattern> VISUAL =
      Map.of(
          "paint", Pattern.compile("#[0-9a-fA-F]{6}"),
          "neon", Pattern.compile("#[0-9a-fA-F]{6}|off"),
          "rims", Pattern.compile("[a-z0-9_]{1,24}"),
          "spoiler", Pattern.compile("[a-z0-9_]{1,24}"),
          "bumper", Pattern.compile("[a-z0-9_]{1,24}"),
          "vinyl", Pattern.compile("[a-z0-9_]{1,24}"));

  public GarageService(
      CarCatalog catalog, OwnedCarRepository cars, EconomyService economy, LedgerRepository ledger) {
    this.catalog = catalog;
    this.cars = cars;
    this.economy = economy;
    this.ledger = ledger;
  }

  public List<OwnedCar> list(UUID userId) {
    return cars.findByUserIdOrderByCreatedAt(userId);
  }

  private void recompute(OwnedCar c) {
    var car = catalog.car(c.carId);
    c.pi = PiCalculator.compute(car.config(), c.parts, catalog.tuning());
    c.carClass = PiCalculator.carClass(c.pi, catalog.tuning());
  }

  @Transactional
  public OwnedCar give(UUID userId, String carId) {
    if (catalog.car(carId) == null) throw ApiException.bad("unknown_car", "нет такой машины");
    OwnedCar c = new OwnedCar();
    c.id = UUID.randomUUID();
    c.userId = userId;
    c.carId = carId;
    recompute(c);
    return cars.save(c);
  }

  /** Покупка машины: списание и выдача в одной транзакции; повтор ключа — та же машина. */
  @Transactional
  public OwnedCar buy(UUID userId, String carId, String key) {
    var car = catalog.car(carId);
    if (car == null) throw ApiException.bad("unknown_car", "нет такой машины");
    String k = "buy_car:" + key;
    UUID newId = UUID.randomUUID();
    var r = economy.apply(userId, -car.price(), 0, "buy_car", newId.toString(), k);
    if (r.replayed()) return previous(userId, r.entryId());
    OwnedCar c = new OwnedCar();
    c.id = newId;
    c.userId = userId;
    c.carId = carId;
    recompute(c);
    return cars.save(c);
  }

  /** Повтор покупки: id машины записан в ref журнала. */
  private OwnedCar previous(UUID userId, long entryId) {
    String ref = ledger.findById(entryId).map(e -> e.ref).orElse("");
    return cars.findById(UUID.fromString(ref))
        .filter(c -> c.userId.equals(userId))
        .orElseThrow(() -> ApiException.notFound("покупка не найдена"));
  }

  @Transactional
  public OwnedCar upgrade(UUID userId, UUID ownedId, String category, int level, String key) {
    OwnedCar c = owned(userId, ownedId);
    if (!CarCatalog.CATEGORIES.contains(category)) throw ApiException.bad("unknown_part", "нет такой категории");
    if (level < 1 || level > catalog.maxLevel()) throw ApiException.bad("bad_level", "уровень 1–" + catalog.maxLevel());
    int current = c.parts.getOrDefault(category, 0);
    String k = "part:" + ownedId + ":" + key;
    if (economy.seen(userId, k)) return c;
    if (level <= current) throw ApiException.bad("already_installed", "уже стоит этот уровень или выше");
    economy.apply(userId, -catalog.partPrice(category, level), 0, "buy_part", ownedId + ":" + category + ":" + level, k);
    Map<String, Integer> parts = new HashMap<>(c.parts);
    parts.put(category, level);
    c.parts = parts;
    recompute(c);
    return cars.save(c);
  }

  @Transactional
  public OwnedCar visual(UUID userId, UUID ownedId, Map<String, String> visual) {
    OwnedCar c = owned(userId, ownedId);
    Map<String, String> v = new HashMap<>(c.visual);
    for (var e : visual.entrySet()) {
      Pattern p = VISUAL.get(e.getKey());
      if (p == null) throw ApiException.bad("unknown_slot", "нет слота " + e.getKey());
      if (!p.matcher(e.getValue()).matches()) throw ApiException.bad("bad_value", "неверное значение " + e.getKey());
      v.put(e.getKey(), e.getValue());
    }
    c.visual = v;
    return cars.save(c);
  }

  public OwnedCar owned(UUID userId, UUID ownedId) {
    OwnedCar c = cars.findById(ownedId).orElseThrow(() -> ApiException.notFound("машина не найдена"));
    if (!c.userId.equals(userId)) throw ApiException.notFound("машина не найдена");
    return c;
  }
}
