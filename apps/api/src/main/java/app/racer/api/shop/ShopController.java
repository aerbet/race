package app.racer.api.shop;

import app.racer.api.auth.TokenService;
import java.util.List;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ShopController {
  private final CosmeticsService cosmetics;

  public ShopController(CosmeticsService cosmetics) {
    this.cosmetics = cosmetics;
  }

  @GetMapping("/api/shop/cosmetics")
  public List<CosmeticsService.Item> list(Authentication auth) {
    return cosmetics.list(auth == null ? null : TokenService.userId(auth));
  }

  @PostMapping("/api/shop/cosmetics/{id}/buy")
  public CosmeticsService.Item buy(Authentication auth, @PathVariable String id) {
    return cosmetics.buy(TokenService.userId(auth), id);
  }
}
