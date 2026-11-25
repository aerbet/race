import { describe, expect, it } from 'vitest';
import { DISPATCHER, storyNext } from './story';

describe('dispatcher story', () => {
  it('every choice leads to an existing node and every node reaches the end', () => {
    const nodes = DISPATCHER.nodes;
    for (const [id, n] of Object.entries(nodes)) {
      for (const c of n.choices) expect(nodes[c.next], `${id} → ${c.next}`).toBeDefined();
      // Из любого узла достижим конец
      const seen = new Set<string>();
      const stack = [id];
      let reach = false;
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        if (nodes[cur]!.end) reach = true;
        for (const c of nodes[cur]!.choices) stack.push(c.next);
      }
      expect(reach, id).toBe(true);
    }
  });

  it('storyNext validates transitions', () => {
    expect(storyNext(DISPATCHER, 'hello', 0)).toBe('rules');
    expect(storyNext(DISPATCHER, 'hello', 5)).toBeNull();
    expect(storyNext(DISPATCHER, 'nope', 0)).toBeNull();
  });
});
