package app.racer.api.common;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public record AppProperties(
    Jwt jwt,
    Telegram telegram,
    String internalKey,
    String verifierUrl,
    String corsOrigins,
    long startingCredits) {
  public record Jwt(String secret, int ttlHours) {}

  public record Telegram(String botToken) {}
}
