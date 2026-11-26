package app.racer.api.shop;

import app.racer.api.payments.ShopCatalog;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Ротация витрины (9.4): обычные предметы есть всегда, из редких, эпических и легендарных
 * каждые сутки (UTC) на витрине — {@code size} штук, среди них один легендарный образ.
 * Набор зависит только от даты — одинаков для всех игроков и после перезапуска сервера.
 */
@Component
public class ShopRotation {
  private final ShopCatalog catalog;
  private final int size;

  public ShopRotation(ShopCatalog catalog, @Value("${app.shop.rotation-size:6}") int size) {
    this.catalog = catalog;
    this.size = size;
  }

  public static long day(Instant now) {
    return now.atZone(ZoneOffset.UTC).toLocalDate().toEpochDay();
  }

  /** Когда сменится витрина: следующая полночь UTC. */
  public static Instant endsAt(Instant now) {
    return LocalDate.ofEpochDay(day(now) + 1).atStartOfDay().toInstant(ZoneOffset.UTC);
  }

  /** id предметов, которые сегодня можно купить. */
  public Set<String> available(Instant now) {
    Set<String> out = new HashSet<>();
    List<ShopCatalog.Cosmetic> legendary = new ArrayList<>();
    List<ShopCatalog.Cosmetic> special = new ArrayList<>();
    for (var c : catalog.cosmetics()) {
      switch (c.rarity()) {
        case "common" -> out.add(c.id());
        case "legendary" -> legendary.add(c);
        default -> special.add(c);
      }
    }
    legendary.sort(Comparator.comparing(ShopCatalog.Cosmetic::id));
    special.sort(Comparator.comparing(ShopCatalog.Cosmetic::id));
    Random r = new Random(day(now) * 1_000_003L + 17);
    Collections.shuffle(legendary, r);
    Collections.shuffle(special, r);
    int left = size;
    if (!legendary.isEmpty() && left > 0) {
      out.add(legendary.get(0).id());
      left--;
    }
    for (int i = 0; i < Math.min(left, special.size()); i++) out.add(special.get(i).id());
    return out;
  }
}
