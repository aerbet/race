package app.racer.api.economy;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "ledger")
public class LedgerEntry {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  public Long id;

  @Column(name = "user_id")
  public UUID userId;

  @Column(name = "credits_delta")
  public long creditsDelta;

  @Column(name = "tokens_delta")
  public long tokensDelta;

  @Column(name = "credits_after")
  public long creditsAfter;

  @Column(name = "tokens_after")
  public long tokensAfter;

  public String reason;
  public String ref;

  @Column(name = "idempotency_key")
  public String idempotencyKey;

  @Column(name = "created_at")
  public Instant createdAt = Instant.now();
}
