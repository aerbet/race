package app.racer.api.ratings;

/** Многопользовательский Эло: попарные сравнения по местам, K делится на (n−1). */
public final class Elo {
  public static final int K = 32;

  private Elo() {}

  /**
   * ratings[i] — текущий рейтинг, places[i] — место (1 — первый; одинаковые места = ничья,
   * например оба не финишировали). Возвращает изменения рейтинга.
   */
  public static int[] deltas(int[] ratings, int[] places) {
    int n = ratings.length;
    int[] out = new int[n];
    if (n < 2) return out;
    for (int i = 0; i < n; i++) {
      double sum = 0;
      for (int j = 0; j < n; j++) {
        if (i == j) continue;
        double expected = 1.0 / (1.0 + Math.pow(10, (ratings[j] - ratings[i]) / 400.0));
        double score = places[i] < places[j] ? 1 : places[i] == places[j] ? 0.5 : 0;
        sum += score - expected;
      }
      out[i] = (int) Math.round(K * sum / (n - 1));
    }
    return out;
  }
}
