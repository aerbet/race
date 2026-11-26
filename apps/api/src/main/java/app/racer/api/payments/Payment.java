package app.racer.api.payments;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "payments")
public class Payment {
  @Id public UUID id;

  @Column(name = "user_id")
  public UUID userId;

  public String provider;

  @Column(name = "product_id")
  public String productId;

  public int tokens;
  public BigDecimal amount;
  public String currency;
  /** pending → paid | failed | expired */
  public String status = "pending";

  @Column(name = "provider_payment_id")
  public String providerPaymentId;

  @Column(name = "pay_url")
  public String payUrl;

  @Column(name = "idempotency_key")
  public String idempotencyKey;

  @Column(name = "created_at")
  public Instant createdAt = Instant.now();

  @Column(name = "paid_at")
  public Instant paidAt;
}
