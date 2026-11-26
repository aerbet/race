package app.racer.api.shop;

import app.racer.api.common.ApiException;
import app.racer.api.economy.EconomyService;
import app.racer.api.payments.ShopCatalog;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Косметика за жетоны — только внешний вид, на физику не влияет. */
@Service
public class CosmeticsService {
  private final ShopCatalog catalog;
  private final EconomyService economy;
  private final JdbcTemplate db;
  private final ShopRotation rotation;
  private final java.time.Clock clock;

  public CosmeticsService(ShopCatalog catalog, EconomyService economy, JdbcTemplate db, ShopRotation rotation, java.util.Optional<java.time.Clock> clock) {
    this.catalog = catalog;
    this.economy = economy;
    this.db = db;
    this.rotation = rotation;
    this.clock = clock.orElse(java.time.Clock.systemUTC());
  }

  public Set<String> owned(UUID userId) {
    return new HashSet<>(db.queryForList("select item_id from owned_cosmetics where user_id = ?", String.class, userId));
  }

  public record Item(String id, String slot, String value, String name, int price, boolean owned, String rarity, boolean inRotation) {}

  private Item item(ShopCatalog.Cosmetic c, boolean owned, Set<String> today) {
    return new Item(c.id(), c.slot(), c.value(), c.name(), c.price(), owned, c.rarity(), today.contains(c.id()));
  }

  public List<Item> list(UUID userId) {
    Set<String> own = userId == null ? Set.of() : owned(userId);
    Set<String> today = rotation.available(clock.instant());
    return catalog.cosmetics().stream().map(c -> item(c, own.contains(c.id()), today)).toList();
  }

  public record Showcase(java.time.Instant endsAt, List<Item> items) {}

  /** Витрина: всё купленное и всё, что сегодня в ротации; плюс время смены витрины. */
  public Showcase showcase(UUID userId) {
    var now = clock.instant();
    return new Showcase(ShopRotation.endsAt(now), list(userId).stream().filter(i -> i.owned() || i.inRotation()).toList());
  }

  @Transactional
  public Item buy(UUID userId, String itemId) {
    var c = catalog.cosmetic(itemId).orElseThrow(() -> ApiException.notFound("нет такого предмета"));
    Set<String> today = rotation.available(clock.instant());
    if (owned(userId).contains(itemId)) return item(c, true, today);
    if (!today.contains(itemId))
      throw new ApiException(HttpStatus.CONFLICT, "not_in_rotation", "этого предмета сегодня нет на витрине");
    // Ключ по предмету: повторная покупка того же предмета невозможна
    var r = economy.apply(userId, 0, -c.price(), "cosmetic", itemId, "cosmetic:" + itemId);
    if (!r.replayed()) db.update("insert into owned_cosmetics(user_id, item_id) values (?, ?) on conflict do nothing", userId, itemId);
    return item(c, true, today);
  }

  /** Можно ли поставить значение в слот: обычные варианты — да, премиальные — только купленные. */
  public void checkVisual(UUID userId, String slot, String value) {
    var c = catalog.cosmeticByValue(slot, value);
    if (c.isPresent() && !owned(userId).contains(c.get().id()))
      throw new ApiException(HttpStatus.PAYMENT_REQUIRED, "not_owned", "«" + c.get().name() + "» нужно купить в ателье");
  }
}
