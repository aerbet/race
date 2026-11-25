package app.racer.api.auth;

import app.racer.api.common.ApiException;
import app.racer.api.common.AppProperties;
import app.racer.api.economy.EconomyService;
import app.racer.api.garage.GarageService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Вход: email + пароль и Telegram Login Widget. VK ID — позже (нужна регистрация приложения).
 * Новый игрок получает стартовые кредиты и первую машину.
 */
@RestController
public class AuthController {
  private final UserRepository users;
  private final PasswordEncoder encoder;
  private final TokenService tokens;
  private final EconomyService economy;
  private final GarageService garage;
  private final AppProperties props;

  public AuthController(
      UserRepository users,
      PasswordEncoder encoder,
      TokenService tokens,
      EconomyService economy,
      GarageService garage,
      AppProperties props) {
    this.users = users;
    this.encoder = encoder;
    this.tokens = tokens;
    this.economy = economy;
    this.garage = garage;
    this.props = props;
  }

  public record Register(@Email @NotBlank String email, @Size(min = 8, max = 72) String password, @Size(min = 2, max = 32) String name) {}

  public record Login(@NotBlank String email, @NotBlank String password) {}

  public record TokenResponse(String token, UUID userId, String name) {}

  @Transactional
  User create(String name) {
    User u = new User();
    u.id = UUID.randomUUID();
    u.displayName = name;
    return u;
  }

  @Transactional
  void onboardNew(User u) {
    economy.openWallet(u.id, props.startingCredits());
    garage.give(u.id, "era2000_coupe");
  }

  @PostMapping("/api/auth/register")
  @Transactional
  public TokenResponse register(@Valid @RequestBody Register r) {
    if (users.findByEmailIgnoreCase(r.email()).isPresent())
      throw new ApiException(HttpStatus.CONFLICT, "email_taken", "этот email уже зарегистрирован");
    User u = create(r.name().trim());
    u.email = r.email().trim().toLowerCase();
    u.passwordHash = encoder.encode(r.password());
    users.save(u);
    onboardNew(u);
    return new TokenResponse(tokens.issue(u), u.id, u.displayName);
  }

  @PostMapping("/api/auth/login")
  public TokenResponse login(@Valid @RequestBody Login r) {
    User u =
        users.findByEmailIgnoreCase(r.email().trim())
            .filter(x -> x.passwordHash != null && encoder.matches(r.password(), x.passwordHash))
            .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "bad_credentials", "неверный email или пароль"));
    return new TokenResponse(tokens.issue(u), u.id, u.displayName);
  }

  /** Данные Telegram Login Widget как есть (id, first_name, username, auth_date, hash…). */
  @PostMapping("/api/auth/telegram")
  @Transactional
  public TokenResponse telegram(@RequestBody Map<String, String> data) {
    if (!TelegramVerifier.verify(data, props.telegram().botToken(), 86400))
      throw new ApiException(HttpStatus.UNAUTHORIZED, "bad_signature", "подпись Telegram не прошла проверку");
    long tgId = Long.parseLong(data.get("id"));
    User u =
        users.findByTelegramId(tgId)
            .orElseGet(
                () -> {
                  String name = data.getOrDefault("username", data.getOrDefault("first_name", "Гонщик"));
                  User nu = create(name.length() > 32 ? name.substring(0, 32) : name);
                  nu.telegramId = tgId;
                  users.save(nu);
                  onboardNew(nu);
                  return nu;
                });
    return new TokenResponse(tokens.issue(u), u.id, u.displayName);
  }

  @GetMapping("/api/me")
  public Map<String, Object> me(Authentication auth) {
    User u = users.findById(TokenService.userId(auth)).orElseThrow(() -> ApiException.notFound("нет пользователя"));
    return Map.of("id", u.id, "name", u.displayName, "email", u.email == null ? "" : u.email, "telegram", u.telegramId != null);
  }

  @GetMapping("/api/health")
  public Map<String, Object> health() {
    return Map.of("ok", true);
  }
}
