package app.racer.api.payments;

import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

final class Http {
  private Http() {}

  /** HTTP/1.1, таймауты — внешние платёжные API. */
  static RestClient client() {
    var factory =
        new JdkClientHttpRequestFactory(
            HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10)).build());
    factory.setReadTimeout(Duration.ofSeconds(20));
    return RestClient.builder().requestFactory(factory).build();
  }
}
