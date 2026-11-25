package app.racer.api.auth;

import app.racer.api.common.AppProperties;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

@Service
public class TokenService {
  private final JwtEncoder encoder;
  private final AppProperties props;

  public TokenService(JwtEncoder encoder, AppProperties props) {
    this.encoder = encoder;
    this.props = props;
  }

  public String issue(User u) {
    Instant now = Instant.now();
    JwtClaimsSet claims =
        JwtClaimsSet.builder()
            .subject(u.id.toString())
            .issuedAt(now)
            .expiresAt(now.plus(props.jwt().ttlHours(), ChronoUnit.HOURS))
            .claim("name", u.displayName)
            .build();
    return encoder
        .encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
        .getTokenValue();
  }

  /** id текущего пользователя из JWT. */
  public static UUID userId(Authentication auth) {
    return UUID.fromString(((Jwt) auth.getPrincipal()).getSubject());
  }
}
