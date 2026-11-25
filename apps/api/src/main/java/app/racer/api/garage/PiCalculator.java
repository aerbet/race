package app.racer.api.garage;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;

/**
 * Индекс мощности — точная копия applyTuning + computePI из packages/shared/src/tuning/tuning.ts.
 * Совпадение проверяется общим файлом pi-fixtures.json в тестах обеих сторон.
 */
public final class PiCalculator {
  private PiCalculator() {}

  private static double round(double v, int d) {
    double p = Math.pow(10, d);
    return Math.floor(v * p + 0.5) / p;
  }

  private static double eff(JsonNode tuning, String cat, String key, int level, double headroom) {
    int lv = Math.max(0, Math.min(tuning.path("levels").asInt(4), level));
    JsonNode arr = tuning.path("categories").path(cat).path(key);
    return (arr.isArray() ? arr.path(lv).asDouble(0) : 0) * headroom;
  }

  public static int compute(JsonNode car, Map<String, Integer> parts, JsonNode tuning) {
    double h = tuning.path("eraHeadroom").path(car.path("era").asText()).asDouble(1);
    java.util.function.ToIntFunction<String> lv = k -> parts.getOrDefault(k, 0);
    double torque = 1 + eff(tuning, "engine", "torque", lv.applyAsInt("engine"), h) + eff(tuning, "turbo", "torque", lv.applyAsInt("turbo"), h);
    double peakKw = 0;
    for (JsonNode pt : car.path("engine").path("torqueCurve")) {
      double rpm = pt.get(0).asDouble();
      double nm = round(pt.get(1).asDouble() * torque, 2);
      peakKw = Math.max(peakKw, (nm * rpm) / 9549);
    }
    double grip = 1 + eff(tuning, "tires", "grip", lv.applyAsInt("tires"), h);
    double front = round(car.path("tires").path("frontGrip").asDouble() * grip, 4);
    double rear = round(car.path("tires").path("rearGrip").asDouble() * grip, 4);
    double brakes = round(car.path("brakes").path("maxForce").asDouble() * (1 + eff(tuning, "brakes", "brakeForce", lv.applyAsInt("brakes"), h)), 1);
    double boost = round(Math.min(0.4, car.path("nitro").path("boost").asDouble() + eff(tuning, "nitro", "boost", lv.applyAsInt("nitro"), h)), 4);
    double mass = round(car.path("mass").asDouble() * (1 + eff(tuning, "weight", "mass", lv.applyAsInt("weight"), h)), 1);
    double kwPerTon = peakKw / (mass / 1000);
    double gripAvg = (front + rear) / 2;
    double brakeDecel = brakes / mass;
    double pi = 50 + 2.0 * kwPerTon + 400 * (gripAvg - 1) + 8 * (brakeDecel - 10) + 150 * boost;
    return (int) Math.max(100, Math.min(999, Math.floor(pi + 0.5)));
  }

  public static String carClass(int pi, JsonNode tuning) {
    String cls = "D";
    for (JsonNode k : tuning.path("classes")) if (pi >= k.path("min").asInt()) cls = k.path("id").asText();
    return cls;
  }
}
