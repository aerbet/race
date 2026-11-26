package app.racer.api.payments;

import app.racer.api.auth.UserRepository;
import app.racer.api.common.ApiException;
import app.racer.api.economy.EconomyService;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Покупка жетонов. Жетоны начисляются только когда провайдер подтвердил оплату
 * (вебхук + обязательная перепроверка статуса и суммы запросом к провайдеру).
 * Начисление идемпотентно: ключ журнала — payment:{id}.
 */
@Service
public class PaymentService {
  private static final Logger log = LoggerFactory.getLogger(PaymentService.class);
  private final Map<String, PaymentProvider> providers = new LinkedHashMap<>();
  private final PaymentRepository payments;
  private final ShopCatalog catalog;
  private final EconomyService economy;
  private final UserRepository users;
  /** Вызовы confirm() изнутри класса идут мимо прокси @Transactional — оборачиваем явно. */
  private final org.springframework.transaction.support.TransactionTemplate tx;

  public PaymentService(
      List<PaymentProvider> list,
      PaymentRepository payments,
      ShopCatalog catalog,
      EconomyService economy,
      UserRepository users,
      org.springframework.transaction.PlatformTransactionManager txm) {
    this.tx = new org.springframework.transaction.support.TransactionTemplate(txm);
    for (PaymentProvider p : list) providers.put(p.id(), p);
    this.payments = payments;
    this.catalog = catalog;
    this.economy = economy;
    this.users = users;
  }

  public record Offer(String id, String name, int tokens, String badge, Map<String, Price> prices) {}

  public record Price(String amount, String currency) {}

  /** Пакеты с ценами у включённых провайдеров. */
  public List<Offer> offers() {
    return catalog.packs().stream()
        .map(p -> {
          Map<String, Price> prices = new LinkedHashMap<>();
          for (PaymentProvider pr : providers.values())
            if (pr.enabled()) prices.put(pr.id(), new Price(pr.price(p).toPlainString(), pr.currency()));
          return new Offer(p.id(), p.name(), p.tokens(), p.badge(), prices);
        })
        .toList();
  }

  public PaymentProvider provider(String id) {
    PaymentProvider p = providers.get(id);
    if (p == null || !p.enabled()) throw ApiException.bad("provider_disabled", "этот способ оплаты сейчас недоступен");
    return p;
  }

  @Transactional
  public Payment create(UUID userId, String productId, String providerId, String key) {
    if (key == null || key.isBlank() || key.length() > 128) throw ApiException.bad("idempotency_key", "нужен ключ идемпотентности");
    var prev = payments.findByUserIdAndIdempotencyKey(userId, key);
    if (prev.isPresent()) return prev.get();
    var pack = catalog.pack(productId).orElseThrow(() -> ApiException.bad("unknown_product", "нет такого товара"));
    PaymentProvider pr = provider(providerId);
    Payment p = new Payment();
    p.id = UUID.randomUUID();
    p.userId = userId;
    p.provider = pr.id();
    p.productId = pack.id();
    p.tokens = pack.tokens();
    p.amount = pr.price(pack);
    p.currency = pr.currency();
    p.idempotencyKey = key;
    payments.save(p);
    String email = users.findById(userId).map(u -> u.email).orElse(null);
    try {
      var created = pr.create(p, pack.name(), email);
      p.providerPaymentId = created.providerPaymentId();
      p.payUrl = created.payUrl();
    } catch (ApiException e) {
      throw e;
    } catch (Exception e) {
      log.warn("провайдер {} не создал платёж: {}", pr.id(), e.toString());
      throw new ApiException(HttpStatus.BAD_GATEWAY, "provider_error", "платёжный сервис недоступен, попробуйте позже");
    }
    return payments.save(p);
  }

  /** Перепроверить у провайдера и, если оплачено, начислить жетоны (один раз). */
  @Transactional
  public Payment confirm(UUID paymentId) {
    Payment p = payments.lockById(paymentId).orElseThrow(() -> ApiException.notFound("платёж не найден"));
    if (!"pending".equals(p.status) || p.providerPaymentId == null) return p;
    PaymentProvider pr = providers.get(p.provider);
    if (pr == null || !pr.enabled()) return p;
    PaymentProvider.Remote r = pr.fetch(p.providerPaymentId);
    switch (r.status()) {
      case "paid" -> {
        boolean sameOrder = r.ourPaymentId().isEmpty() || r.ourPaymentId().equals(p.id.toString());
        if (r.amount().compareTo(p.amount) != 0 || !sameOrder) {
          log.error("платёж {}: сумма/заказ не совпали ({} {} / {})", p.id, r.amount(), r.currency(), r.ourPaymentId());
          p.status = "failed";
        } else {
          economy.apply(p.userId, 0, p.tokens, "purchase", p.id.toString(), "payment:" + p.id);
          p.status = "paid";
          p.paidAt = Instant.now();
        }
      }
      case "failed" -> p.status = "failed";
      case "expired" -> p.status = "expired";
      default -> {
        // Счёт без оплаты дольше суток — закрываем
        if (Duration.between(p.createdAt, Instant.now()).toHours() > 24) p.status = "expired";
      }
    }
    return payments.save(p);
  }

  /** Статус для клиента (опрос): незавершённый платёж перепроверяем у провайдера не чаще раза в 5 с. */
  public Payment status(UUID userId, UUID id) {
    Payment p = payments.findById(id).filter(x -> x.userId.equals(userId)).orElseThrow(() -> ApiException.notFound("платёж не найден"));
    if ("pending".equals(p.status) && Duration.between(p.createdAt, Instant.now()).toSeconds() >= 5) {
      try {
        return tx.execute(st -> confirm(id));
      } catch (Exception e) {
        log.warn("перепроверка платежа {} не удалась: {}", id, e.toString());
      }
    }
    return p;
  }

  public List<Payment> history(UUID userId) {
    return payments.findTop20ByUserIdOrderByCreatedAtDesc(userId);
  }

  public Payment byProvider(String provider, String providerPaymentId) {
    return payments.findByProviderAndProviderPaymentId(provider, providerPaymentId).orElse(null);
  }
}
