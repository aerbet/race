package app.racer.api.common;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

/** Юнит-тест без Spring и базы: проверка секретов при старте в prod (PLAN_V2 7.0.2). */
class SecretsGuardTest {
  private static final String GOOD = "a".repeat(48);

  @Test
  void devValuesAreAllowedOutsideProd() {
    assertDoesNotThrow(() -> SecretsGuard.check(false, "dev-only-secret-change-me-0123456789abcdef", "dev-internal-key"));
  }

  @Test
  void prodRejectsDefaultsMissingAndShortSecrets() {
    assertThrows(IllegalStateException.class,
        () -> SecretsGuard.check(true, "dev-only-secret-change-me-0123456789abcdef", GOOD));
    assertThrows(IllegalStateException.class, () -> SecretsGuard.check(true, GOOD, "dev-internal-key"));
    assertThrows(IllegalStateException.class, () -> SecretsGuard.check(true, "short", GOOD));
    assertThrows(IllegalStateException.class, () -> SecretsGuard.check(true, null, GOOD));
    assertThrows(IllegalStateException.class, () -> SecretsGuard.check(true, GOOD, ""));
  }

  @Test
  void prodAcceptsRealSecrets() {
    assertDoesNotThrow(() -> SecretsGuard.check(true, GOOD, "b".repeat(32)));
  }
}
