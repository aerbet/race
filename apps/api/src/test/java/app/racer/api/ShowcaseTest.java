package app.racer.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.racer.api.economy.EconomyService;
import app.racer.api.payments.ShopCatalog;
import app.racer.api.shop.ShopRotation;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class ShowcaseTest extends TestBase {
  @Autowired ShopRotation rotation;
  @Autowired ShopCatalog catalog;
  @Autowired EconomyService economy;

  @Test
  void rotationIsDailyAndHasOneLegendary() {
    Instant d1 = Instant.parse("2026-12-01T10:00:00Z");
    var a = rotation.available(d1);
    assertThat(rotation.available(Instant.parse("2026-12-01T23:59:00Z"))).isEqualTo(a);
    long commons = catalog.cosmetics().stream().filter(c -> c.rarity().equals("common")).count();
    assertThat(a).hasSize((int) commons + 6);
    assertThat(a.stream().filter(id -> id.startsWith("look_")).count()).isEqualTo(1);
    // За неделю витрина меняется
    boolean changed = false;
    for (int i = 1; i <= 7; i++) changed |= !rotation.available(d1.plusSeconds(86400L * i)).equals(a);
    assertThat(changed).isTrue();
    assertThat(ShopRotation.endsAt(d1)).isEqualTo(Instant.parse("2026-12-02T00:00:00Z"));
  }

  @Test
  void catalogHasLooksAndRarity() {
    assertThat(catalog.cosmetic("look_sakura")).get().extracting(ShopCatalog.Cosmetic::rarity).isEqualTo("legendary");
    assertThat(catalog.cosmetic("kit_drift")).get().extracting(ShopCatalog.Cosmetic::rarity).isEqualTo("epic");
  }

  @Test
  void buyOnlyFromShowcaseAndWearLook() throws Exception {
    String t = register("show1@test.ru");
    UUID user = UUID.fromString(json(get("/api/me", t), 200).get("id").asText());
    economy.apply(user, 0, 5000, "test", "grant", "test:" + user);
    JsonNode show = json(get("/api/shop/showcase", t), 200);
    assertThat(show.get("endsAt").asText()).isNotBlank();
    JsonNode all = json(get("/api/shop/cosmetics", t), 200);
    String off = null;
    for (JsonNode i : all) if (!i.get("inRotation").asBoolean()) off = i.get("id").asText();
    // Не на витрине — купить нельзя
    json(post("/api/shop/cosmetics/" + off + "/buy", Map.of(), t), 409);
    String look = null;
    for (JsonNode i : show.get("items")) if (i.get("slot").asText().equals("look")) look = i.get("value").asText();
    assertThat(look).isNotNull();
    String car = json(get("/api/garage", t), 200).get(0).get("id").asText();
    var put = MockMvcRequestBuilders.put("/api/garage/cars/" + car + "/visual").header("Authorization", "Bearer " + t).contentType("application/json");
    // Образ не куплен — нельзя
    json(put.content("{\"look\":\"" + look + "\"}"), 402);
    json(post("/api/shop/cosmetics/look_" + look + "/buy", Map.of(), t), 200);
    assertThat(json(put.content("{\"look\":\"" + look + "\"}"), 200).get("visual").get("look").asText()).isEqualTo(look);
    // Снять образ можно всегда
    json(put.content("{\"look\":\"none\",\"livery\":\"none\"}"), 200);
  }
}
