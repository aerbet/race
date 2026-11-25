package app.racer.api.garage;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "owned_cars")
public class OwnedCar {
  @Id public UUID id;

  @Column(name = "user_id")
  public UUID userId;

  @Column(name = "car_id")
  public String carId;

  @JdbcTypeCode(SqlTypes.JSON)
  public Map<String, Integer> parts = new HashMap<>();

  @JdbcTypeCode(SqlTypes.JSON)
  public Map<String, String> visual = new HashMap<>();

  public int pi;

  @Column(name = "car_class")
  public String carClass;

  @Column(name = "created_at")
  public Instant createdAt = Instant.now();
}
