package app.racer.api.onboarding;

import app.racer.api.auth.TokenService;
import java.io.IOException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OnboardingController {
  private final OnboardingService onboarding;

  public OnboardingController(OnboardingService onboarding) {
    this.onboarding = onboarding;
  }

  @GetMapping("/api/onboarding")
  public OnboardingService.State state(Authentication auth) {
    return onboarding.state(TokenService.userId(auth));
  }

  public record Choose(String node, int choice) {}

  @PostMapping("/api/onboarding")
  public OnboardingService.State choose(Authentication auth, @RequestBody Choose body) throws IOException {
    return onboarding.choose(TokenService.userId(auth), body.node(), body.choice());
  }
}
