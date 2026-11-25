import { describe, expect, it } from 'vitest';
import { DelayedChannel, parseNetConditions } from './netsim';

function harness(cond: { latency: number; jitter: number; loss: number }) {
  let now = 0;
  const queue: { at: number; fn: () => void }[] = [];
  const got: { msg: number; at: number }[] = [];
  const ch = new DelayedChannel<number>(
    cond,
    (msg) => got.push({ msg, at: now }),
    () => now,
    (fn, ms) => queue.push({ at: now + ms, fn }),
    7,
  );
  const run = (until: number) => {
    queue.sort((a, b) => a.at - b.at);
    while (queue.length && queue[0]!.at <= until) {
      const q = queue.shift()!;
      now = q.at;
      q.fn();
    }
    now = until;
  };
  return { ch, got, run, setNow: (t: number) => (now = t) };
}

describe('DelayedChannel', () => {
  it('delivers in order with latency, jitter and loss', () => {
    const h = harness({ latency: 150, jitter: 30, loss: 0.02 });
    for (let i = 0; i < 300; i++) {
      h.setNow(i * 33);
      h.ch.send(i);
    }
    h.run(100000);
    expect(h.got.map((g) => g.msg)).toEqual([...Array(300).keys()]);
    const delays = h.got.map((g) => g.at - g.msg * 33);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(120);
    // Были «потери» → заметные задержки
    expect(Math.max(...delays)).toBeGreaterThan(500);
  });

  it('passes through instantly when disabled', () => {
    const h = harness({ latency: 0, jitter: 0, loss: 0 });
    h.ch.send(1);
    expect(h.got).toEqual([{ msg: 1, at: 0 }]);
  });

  it('parses url params', () => {
    expect(parseNetConditions(new URLSearchParams('lag=150&jitter=20&loss=2'))).toEqual({
      latency: 150,
      jitter: 20,
      loss: 0.02,
    });
  });
});
