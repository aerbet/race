package app.racer.api.common;

import java.nio.charset.StandardCharsets;
import java.util.Set;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * В продакшене (профиль prod) API не стартует с секретами по умолчанию: иначе любой, кто знает
 * dev-значение из репозитория, подделает токен входа или внутренний ключ (PLAN_V2 7.0.2).
 */
@Component
public class SecretsGuard {
  /** Значения по умолчанию из application.yml и race-server — только для разработки. */
  static final Set<String> DEV_VALUES =
      Set.of("dev-only-secret-change-me-0123456789abcdef", "dev-internal-key");

  private final AppProperties props;
  private final Environment env;

  public SecretsGuard(AppProperties props, Environment env) {
    this.props = props;
    this.env = env;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void verify() {
    check(env.acceptsProfiles(Profiles.of("prod")), props.jwt().secret(), props.internalKey());
  }

  /** Бросает IllegalStateException, если в продакшене секрет не задан, короткий или dev-значение. */
  public static void check(boolean prod, String jwtSecret, String internalKey) {
    if (!prod) return;
    if (jwtSecret == null || jwtSecret.getBytes(StandardCharsets.UTF_8).length < 32 || DEV_VALUES.contains(jwtSecret))
      throw new IllegalStateException("JWT_SECRET не задан или это значение для разработки — в prod запуск запрещён");
    if (internalKey == null || internalKey.length() < 16 || DEV_VALUES.contains(internalKey))
      throw new IllegalStateException("INTERNAL_KEY не задан или это значение для разработки — в prod запуск запрещён");
  }
}
