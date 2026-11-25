package app.racer.api.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Проверка данных Telegram Login Widget: hash = HMAC-SHA256(data_check_string, SHA256(bot_token)).
 * https://core.telegram.org/widgets/login#checking-authorization
 */
public final class TelegramVerifier {
  private TelegramVerifier() {}

  public static boolean verify(Map<String, String> data, String botToken, long maxAgeSeconds) {
    if (botToken == null || botToken.isBlank()) return false;
    String hash = data.get("hash");
    if (hash == null) return false;
    String check =
        new TreeMap<>(data)
            .entrySet().stream()
                .filter(e -> !e.getKey().equals("hash"))
                .map(e -> e.getKey() + "=" + e.getValue())
                .collect(Collectors.joining("\n"));
    try {
      byte[] secret = MessageDigest.getInstance("SHA-256").digest(botToken.getBytes(StandardCharsets.UTF_8));
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret, "HmacSHA256"));
      String expected = HexFormat.of().formatHex(mac.doFinal(check.getBytes(StandardCharsets.UTF_8)));
      if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), hash.getBytes(StandardCharsets.UTF_8)))
        return false;
      long authDate = Long.parseLong(data.getOrDefault("auth_date", "0"));
      return Instant.now().getEpochSecond() - authDate <= maxAgeSeconds;
    } catch (Exception e) {
      return false;
    }
  }

  /** Подпись для тестов. */
  public static String sign(Map<String, String> data, String botToken) throws Exception {
    String check =
        new TreeMap<>(data)
            .entrySet().stream()
                .map(e -> e.getKey() + "=" + e.getValue())
                .collect(Collectors.joining("\n"));
    byte[] secret = MessageDigest.getInstance("SHA-256").digest(botToken.getBytes(StandardCharsets.UTF_8));
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret, "HmacSHA256"));
    return HexFormat.of().formatHex(mac.doFinal(check.getBytes(StandardCharsets.UTF_8)));
  }
}
