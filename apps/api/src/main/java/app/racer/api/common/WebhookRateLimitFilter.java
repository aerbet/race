package app.racer.api.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Уведомления платёжных систем (/webhooks/*): не больше 60 в минуту с одного адреса, каждый
 * запрос логируется с источником (PLAN_V2 7.0.3). Оплата всё равно перепроверяется у провайдера.
 */
@Component
public class WebhookRateLimitFilter extends OncePerRequestFilter {
  private static final Logger log = LoggerFactory.getLogger(WebhookRateLimitFilter.class);
  private final RateLimiter limiter = new RateLimiter(60, 60_000);

  @Override
  protected boolean shouldNotFilter(HttpServletRequest req) {
    return !req.getRequestURI().startsWith("/webhooks/");
  }

  /** Адрес клиента: за прокси — первый из X-Forwarded-For. */
  static String source(HttpServletRequest req) {
    String fwd = req.getHeader("X-Forwarded-For");
    if (fwd != null && !fwd.isBlank()) return fwd.split(",")[0].trim();
    return req.getRemoteAddr();
  }

  @Override
  protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
      throws ServletException, IOException {
    String ip = source(req);
    if (!limiter.allow(ip, System.currentTimeMillis())) {
      log.warn("вебхук {}: лимит частоты превышен, источник {}", req.getRequestURI(), ip);
      res.setStatus(429);
      res.getWriter().write("too many requests");
      return;
    }
    log.info("вебхук {} от {} (UA: {})", req.getRequestURI(), ip, req.getHeader("User-Agent"));
    chain.doFilter(req, res);
  }
}
