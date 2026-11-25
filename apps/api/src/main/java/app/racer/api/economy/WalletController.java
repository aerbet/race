package app.racer.api.economy;

import app.racer.api.auth.TokenService;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/wallet")
public class WalletController {
  private final EconomyService economy;
  private final LedgerRepository ledger;

  public WalletController(EconomyService economy, LedgerRepository ledger) {
    this.economy = economy;
    this.ledger = ledger;
  }

  @GetMapping
  public Map<String, Long> wallet(Authentication auth) {
    Wallet w = economy.wallet(TokenService.userId(auth));
    return Map.of("credits", w.credits, "tokens", w.tokens);
  }

  @GetMapping("/ledger")
  public List<LedgerEntry> history(Authentication auth) {
    return ledger.findByUserIdOrderByCreatedAtDescIdDesc(TokenService.userId(auth), PageRequest.of(0, 50));
  }
}
