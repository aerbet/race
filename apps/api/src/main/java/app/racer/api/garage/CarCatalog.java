package app.racer.api.garage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;

/**
 * Каталог машин и таблица тюнинга — читаются из общих JSON (packages/shared), тех же, что у клиента.
 */
@Component
public class CarCatalog {
  public record Car(String id, String name, String era, long price, JsonNode config) {}

  public static final List<String> CATEGORIES =
      List.of("engine", "turbo", "transmission", "suspension", "tires", "brakes", "nitro", "weight");

  private final Map<String, Car> cars = new LinkedHashMap<>();
  private final JsonNode tuning;

  public CarCatalog(ObjectMapper om) throws IOException {
    var resolver = new PathMatchingResourcePatternResolver();
    try (InputStream in = resolver.getResource("classpath:shared/tuning/parts.json").getInputStream()) {
      tuning = om.readTree(in);
    }
    List<Resource> files = new ArrayList<>(List.of(resolver.getResources("classpath:shared/cars/*.json")));
    files.sort((a, b) -> String.valueOf(a.getFilename()).compareTo(String.valueOf(b.getFilename())));
    for (Resource r : files) {
      try (InputStream in = r.getInputStream()) {
        JsonNode c = om.readTree(in);
        String id = c.get("id").asText();
        long price = tuning.path("carPrices").path(id).asLong(0);
        cars.put(id, new Car(id, c.get("name").asText(), c.get("era").asText(), price, c));
      }
    }
  }

  public Car car(String id) {
    return cars.get(id);
  }

  public List<Car> cars() {
    return List.copyOf(cars.values());
  }

  public JsonNode tuning() {
    return tuning;
  }

  public long partPrice(String category, int level) {
    return tuning.path("categories").path(category).path("price").path(level).asLong(Long.MAX_VALUE);
  }

  public int maxLevel() {
    return tuning.path("levels").asInt(4);
  }
}
