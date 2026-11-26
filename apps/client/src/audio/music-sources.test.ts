import { describe, expect, it } from 'vitest';
import { chordNotes, radioTrack } from './radio';
import { MAX_PLAYLISTS, PlaylistStore } from './playlists';
import { mayPlay } from './youtube';

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

describe('радио игры (8.4)', () => {
  it('трек задаётся зерном', () => {
    expect(radioTrack(7)).toEqual(radioTrack(7));
    expect(radioTrack(7)).not.toEqual(radioTrack(8));
    for (let s = 1; s < 50; s++) {
      const tr = radioTrack(s);
      expect(tr.bpm).toBeGreaterThanOrEqual(96);
      expect(tr.bpm).toBeLessThanOrEqual(122);
      expect(tr.progression).toHaveLength(4);
      expect(tr.bass).toHaveLength(16);
      expect(tr.arp).toHaveLength(16);
    }
  });

  it('аккорды — терции минорной гаммы', () => {
    expect(chordNotes(0)).toEqual([0, 3, 7, 10]);
    expect(chordNotes(5)).toEqual([8, 12, 15, 19]);
  });
});

describe('свои плейлисты (8.2)', () => {
  const id = (n: number) => `PLtest${String(n).padStart(10, '0')}`;

  it('добавление по ссылке, дубль, неверная ссылка, удаление', () => {
    const s = new PlaylistStore(memory());
    expect(s.add('https://youtube.com/watch?v=x')).toBe('bad');
    const p = s.add(`https://www.youtube.com/playlist?list=${id(1)}`, 'Ночь');
    expect(p).toEqual({ id: id(1), title: 'Ночь' });
    expect(s.add(id(1))).toBe('dup');
    expect(s.list()).toHaveLength(1);
    s.remove(id(1));
    expect(s.list()).toEqual([]);
  });

  it('не больше 10', () => {
    const s = new PlaylistStore(memory());
    for (let i = 0; i < MAX_PLAYLISTS; i++) expect(typeof s.add(id(i))).toBe('object');
    expect(s.add(id(99))).toBe('full');
  });

  it('без хранилища не падает', () => {
    const s = new PlaylistStore(null);
    expect(s.list()).toEqual([]);
  });
});

describe('правила YouTube (фаза 8)', () => {
  it('играет только развёрнутый, видимый наполовину плеер на открытой вкладке', () => {
    expect(mayPlay({ collapsed: false, hidden: false, ratio: 1 })).toBe(true);
    expect(mayPlay({ collapsed: false, hidden: false, ratio: 0.5 })).toBe(true);
    expect(mayPlay({ collapsed: false, hidden: false, ratio: 0.49 })).toBe(false);
    expect(mayPlay({ collapsed: true, hidden: false, ratio: 1 })).toBe(false);
    expect(mayPlay({ collapsed: false, hidden: true, ratio: 1 })).toBe(false);
  });
});
