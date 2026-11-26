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

  public CosmeticsService(ShopCatalog catalog, EconomyService economy, JdbcTemplate db) {
    this.catalog = catalog;
    this.economy = economy;
    this.db = db;
  }

  public Set<String> owned(UUID userId) {
    return new HashSet<>(db.queryForList("select item_id from owned_cosmetics where user_id = ?", String.class, userId));
  }

  public record Item(String id, String slot, String value, String name, int price, boolean owned) {}

  public List<Item> list(UUID userId) {
    Set<String> own = userId == null ? Set.of() : owned(userId);
    return catalog.cosmetics().stream()
        .map(c -> new Item(c.id(), c.slot(), c.value(), c.name(), c.price(), own.contains(c.id())))
        .toList();
  }

  @Transactional
  public Item buy(UUID userId, String itemId) {
    var c = catalog.cosmetic(itemId).orElseThrow(() -> ApiException.notFound("нет такого предмета"));
    if (owned(userId).contains(itemId)) return new Item(c.id(), c.slot(), c.value(), c.name(), c.price(), true);
    // Ключ по предмету: повторная покупка того же предмета невозможна
    var r = economy.apply(userId, 0, -c.price(), "cosmetic", itemId, "cosmetic:" + itemId);
    if (!r.replayed()) db.update("insert into owned_cosmetics(user_id, item_id) values (?, ?) on conflict do nothing", userId, itemId);
    return new Item(c.id(), c.slot(), c.value(), c.name(), c.price(), true);
  }

  /** Можно ли поставить значение в слот: обычные варианты — да, премиальные — только купленные. */
  public void checkVisual(UUID userId, String slot, String value) {
    var c = catalog.cosmeticByValue(slot, value);
    if (c.isPresent() && !owned(userId).contains(c.get().id()))
      throw new ApiException(HttpStatus.PAYMENT_REQUIRED, "not_owned", "«" + c.get().name() + "» нужно купить в магазине");
  }
}
