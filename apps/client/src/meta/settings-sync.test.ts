import { afterEach, describe, expect, it, vi } from 'vitest';

// hub тянет за собой плеер файлов (new Audio) — в тестах подменяем
vi.mock('../audio/hub', () => {
  const hub = {
    streamer: false,
    setStreamer(on: boolean) {
      hub.streamer = on;
    },
    onStreamerChange: null,
  };
  return { hub };
});
vi.mock('./api', () => ({ api: vi.fn() }));

const { applySettings } = await import('./settings-sync');
const { PlaylistStore } = await import('../audio/playlists');
const { hub } = await import('../audio/hub');
const { getLang, setLang } = await import('@sr/shared');

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};
const P1 = { id: 'PLDE0DBBFAA8E2F771', title: 'Классика' };

afterEach(() => {
  setLang('ru');
  hub.streamer = false;
});

describe('настройки в профиле (11.5)', () => {
  it('профиль задаёт язык, стримера и плейлисты на устройстве', () => {
    const store = new PlaylistStore(memory());
    const r = applySettings({ lang: 'en', streamer: true, playlists: [P1] }, store);
    expect(r.langChanged).toBe(true);
    expect(getLang()).toBe('en');
    expect(hub.streamer).toBe(true);
    expect(store.list()).toEqual([P1]);
    expect(r.upload).toEqual({});
  });

  it('первый вход: пустой профиль получает настройки с устройства', () => {
    const store = new PlaylistStore(memory());
    store.replace([P1]);
    hub.streamer = true;
    const r = applySettings({}, store);
    expect(r.langChanged).toBe(false);
    expect(r.upload).toEqual({ lang: 'ru', streamer: true, playlists: [P1] });
  });

  it('изменение списка игроком вызывает синхронизацию, замена из профиля — нет', () => {
    const calls: unknown[] = [];
    PlaylistStore.onChange = (l) => calls.push(l);
    const store = new PlaylistStore(memory());
    store.replace([P1]);
    expect(calls).toHaveLength(0);
    store.remove(P1.id);
    expect(calls).toEqual([[]]);
    PlaylistStore.onChange = null;
  });
});
