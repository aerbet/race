package app.racer.api.common;

import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Ограничение частоты: не больше limit запросов за окно windowMs на ключ (обычно IP). */
public class RateLimiter {
  private record Window(long start, int count) {}

  private final int limit;
  private final long windowMs;
  private final Map<String, Window> windows = new ConcurrentHashMap<>();

  public RateLimiter(int limit, long windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** true — запрос пропустить; false — лимит исчерпан. */
  public boolean allow(String key, long nowMs) {
    Window w =
        windows.compute(
            key,
            (k, old) ->
                old == null || nowMs - old.start() >= windowMs
                    ? new Window(nowMs, 1)
                    : new Window(old.start(), old.count() + 1));
    if (windows.size() > 10_000) cleanup(nowMs);
    return w.count() <= limit;
  }

  private void cleanup(long nowMs) {
    for (Iterator<Map.Entry<String, Window>> it = windows.entrySet().iterator(); it.hasNext(); )
      if (nowMs - it.next().getValue().start() >= windowMs) it.remove();
  }
}
