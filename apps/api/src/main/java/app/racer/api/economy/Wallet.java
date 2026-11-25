package app.racer.api.economy;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.util.UUID;

@Entity
@Table(name = "wallets")
public class Wallet {
  @Id
  @Column(name = "user_id")
  public UUID userId;

  public long credits;
  public long tokens;

  @Version public long version;
}
