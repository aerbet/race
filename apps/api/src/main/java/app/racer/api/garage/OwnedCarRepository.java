package app.racer.api.garage;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OwnedCarRepository extends JpaRepository<OwnedCar, UUID> {
  List<OwnedCar> findByUserIdOrderByCreatedAt(UUID userId);
}
