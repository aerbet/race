package app.racer.api.records;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "records")
public class RecordEntity {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  public Long id;

  @Column(name = "user_id")
  public UUID userId;

  @Column(name = "track_id")
  public String trackId;

  @Column(name = "car_class")
  public String carClass;

  @Column(name = "car_id")
  public String carId;

  @Column(name = "lap_steps")
  public int lapSteps;

  public boolean verified;
  public byte[] inputs;

  @Column(name = "created_at")
  public Instant createdAt = Instant.now();
}
