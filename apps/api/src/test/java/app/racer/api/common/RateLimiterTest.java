package app.racer.api.common;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Ограничение частоты вебхуков (PLAN_V2 7.0.3), без Spring и базы. */
class RateLimiterTest {
  @Test
  void limitsPerKeyWithinWindowAndResetsAfter() {
    RateLimiter r = new RateLimiter(3, 1000);
    for (int i = 0; i < 3; i++) assertTrue(r.allow("1.2.3.4", 0));
    assertFalse(r.allow("1.2.3.4", 500));
    assertTrue(r.allow("5.6.7.8", 500)); // другой адрес — свой счёт
    assertTrue(r.allow("1.2.3.4", 1000)); // новое окно
  }
}
