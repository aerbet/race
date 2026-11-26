package app.racer.api.payments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/** Каталог магазина — общий JSON с клиентом (packages/shared/src/shop/shop.json). */
@Component
public class ShopCatalog {
  public record Pack(String id, String name, int tokens, BigDecimal rub, BigDecimal usdt, String badge) {}

  public record Cosmetic(String id, String slot, String value, String name, int price) {}

  private final List<Pack> packs = new ArrayList<>();
  private final List<Cosmetic> cosmetics = new ArrayList<>();

  public ShopCatalog(ObjectMapper om) throws IOException {
    JsonNode root;
    try (InputStream in = new ClassPathResource("shared/shop/shop.json").getInputStream()) {
      root = om.readTree(in);
    }
    for (JsonNode p : root.path("packs"))
      packs.add(new Pack(p.get("id").asText(), p.get("name").asText(), p.get("tokens").asInt(),
          new BigDecimal(p.get("rub").asText()), new BigDecimal(p.get("usdt").asText()), p.path("badge").asText(null)));
    for (JsonNode c : root.path("cosmetics"))
      cosmetics.add(new Cosmetic(c.get("id").asText(), c.get("slot").asText(), c.get("value").asText(), c.get("name").asText(), c.get("price").asInt()));
  }

  public List<Pack> packs() {
    return packs;
  }

  public Optional<Pack> pack(String id) {
    return packs.stream().filter(p -> p.id().equals(id)).findFirst();
  }

  public List<Cosmetic> cosmetics() {
    return cosmetics;
  }

  public Optional<Cosmetic> cosmetic(String id) {
    return cosmetics.stream().filter(c -> c.id().equals(id)).findFirst();
  }

  public Optional<Cosmetic> cosmeticByValue(String slot, String value) {
    return cosmetics.stream().filter(c -> c.slot().equals(slot) && c.value().equals(value)).findFirst();
  }
}
