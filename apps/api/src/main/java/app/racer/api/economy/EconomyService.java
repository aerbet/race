package app.racer.api.economy;

import app.racer.api.common.ApiException;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Единственная точка изменения баланса. Кредиты и жетоны меняются только на сервере,
 * каждая операция пишется в журнал; повтор с тем же ключом идемпотентности
 * возвращает прежний результат и ничего не списывает повторно.
 */
@Service
public class EconomyService {
  private final WalletRepository wallets;
  private final LedgerRepository ledger;

  public EconomyService(WalletRepository wallets, LedgerRepository ledger) {
    this.wallets = wallets;
    this.ledger = ledger;
  }

  public record Result(long credits, long tokens, boolean replayed, long entryId) {}

  @Transactional(propagation = Propagation.MANDATORY)
  public void openWallet(UUID userId, long credits) {
    Wallet w = new Wallet();
    w.userId = userId;
    wallets.save(w);
    if (credits > 0) apply(userId, credits, 0, "welcome", null, "welcome");
  }

  /** Изменить баланс. Вызывать внутри транзакции вызывающего (покупка = списание + выдача товара). */
  @Transactional
  public Result apply(UUID userId, long dCredits, long dTokens, String reason, String ref, String key) {
    if (key == null || key.isBlank() || key.length() > 128)
      throw ApiException.bad("idempotency_key", "нужен ключ идемпотентности (до 128 символов)");
    // Сначала блокируем кошелёк: операции одного игрока идут строго по очереди,
    // поэтому проверка ключа ниже не гоняется с параллельным запросом
    Wallet w = wallets.lockById(userId).orElseThrow(() -> ApiException.notFound("кошелёк не найден"));
    var prev = ledger.findByUserIdAndIdempotencyKey(userId, key);
    if (prev.isPresent()) {
      LedgerEntry e = prev.get();
      return new Result(e.creditsAfter, e.tokensAfter, true, e.id);
    }
    long c = w.credits + dCredits;
    long t = w.tokens + dTokens;
    if (c < 0 || t < 0)
      throw new ApiException(HttpStatus.PAYMENT_REQUIRED, "insufficient_funds", "недостаточно средств");
    w.credits = c;
    w.tokens = t;
    LedgerEntry e = new LedgerEntry();
    e.userId = userId;
    e.creditsDelta = dCredits;
    e.tokensDelta = dTokens;
    e.creditsAfter = c;
    e.tokensAfter = t;
    e.reason = reason;
    e.ref = ref;
    e.idempotencyKey = key;
    ledger.save(e);
    return new Result(c, t, false, e.id);
  }

  public Wallet wallet(UUID userId) {
    return wallets.findById(userId).orElseThrow(() -> ApiException.notFound("кошелёк не найден"));
  }

  /** Уже была ли операция с этим ключом (для идемпотентности составных действий). */
  public boolean seen(UUID userId, String key) {
    return ledger.findByUserIdAndIdempotencyKey(userId, key).isPresent();
  }
}
