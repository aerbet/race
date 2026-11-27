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

  /**
   * Проверка initData Telegram Mini App: secret = HMAC-SHA256(bot_token, ключ «WebAppData»),
   * hash = HMAC-SHA256(data_check_string, secret). Возвращает разобранные поля или null.
   * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
   */
  public static Map<String, String> verifyWebApp(String initData, String botToken, long maxAgeSeconds) {
    if (botToken == null || botToken.isBlank() || initData == null || initData.length() > 4096) return null;
    Map<String, String> data = new TreeMap<>();
    for (String part : initData.split("&")) {
      int i = part.indexOf('=');
      if (i <= 0) continue;
      data.put(
          java.net.URLDecoder.decode(part.substring(0, i), StandardCharsets.UTF_8),
          java.net.URLDecoder.decode(part.substring(i + 1), StandardCharsets.UTF_8));
    }
    String hash = data.get("hash");
    if (hash == null) return null;
    String check =
        data.entrySet().stream()
            .filter(e -> !e.getKey().equals("hash"))
            .map(e -> e.getKey() + "=" + e.getValue())
            .collect(Collectors.joining("\n"));
    try {
      String expected = HexFormat.of().formatHex(hmac(webAppSecret(botToken), check));
      if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), hash.getBytes(StandardCharsets.UTF_8)))
        return null;
      long authDate = Long.parseLong(data.getOrDefault("auth_date", "0"));
      return Instant.now().getEpochSecond() - authDate <= maxAgeSeconds ? data : null;
    } catch (Exception e) {
      return null;
    }
  }

  private static byte[] webAppSecret(String botToken) throws Exception {
    return hmac("WebAppData".getBytes(StandardCharsets.UTF_8), botToken);
  }

  private static byte[] hmac(byte[] key, String msg) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(key, "HmacSHA256"));
    return mac.doFinal(msg.getBytes(StandardCharsets.UTF_8));
  }

  /** initData для тестов: поля (без hash) → строка запроса с подписью Mini App. */
  public static String signWebApp(Map<String, String> fields, String botToken) throws Exception {
    String check =
        new TreeMap<>(fields).entrySet().stream().map(e -> e.getKey() + "=" + e.getValue()).collect(Collectors.joining("\n"));
    String hash = HexFormat.of().formatHex(hmac(webAppSecret(botToken), check));
    StringBuilder sb = new StringBuilder();
    for (var e : fields.entrySet())
      sb.append(java.net.URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)).append('=')
          .append(java.net.URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8)).append('&');
    return sb.append("hash=").append(hash).toString();
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
