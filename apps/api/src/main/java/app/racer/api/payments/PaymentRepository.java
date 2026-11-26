package app.racer.api.payments;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface PaymentRepository extends JpaRepository<Payment, UUID> {
  Optional<Payment> findByUserIdAndIdempotencyKey(UUID userId, String key);

  Optional<Payment> findByProviderAndProviderPaymentId(String provider, String providerPaymentId);

  List<Payment> findTop20ByUserIdOrderByCreatedAtDesc(UUID userId);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select p from Payment p where p.id = :id")
  Optional<Payment> lockById(UUID id);
}
