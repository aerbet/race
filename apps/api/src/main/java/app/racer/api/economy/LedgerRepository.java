package app.racer.api.economy;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LedgerRepository extends JpaRepository<LedgerEntry, Long> {
  Optional<LedgerEntry> findByUserIdAndIdempotencyKey(UUID userId, String key);

  List<LedgerEntry> findByUserIdOrderByCreatedAtDescIdDesc(UUID userId, Pageable page);
}
