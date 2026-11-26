import { parsePlaylistId } from '@sr/shared';

export interface SavedPlaylist {
  id: string;
  title: string;
}

export const MAX_PLAYLISTS = 10;
const KEY = 'sr:yt-playlists';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const safeStorage = (): Store | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/** Свои плейлисты YouTube (8.2): до 10, хранятся в браузере игрока. */
export class PlaylistStore {
  constructor(private store: Store | null = safeStorage()) {}

  list(): SavedPlaylist[] {
    try {
      const v = JSON.parse(this.store?.getItem(KEY) ?? '[]') as SavedPlaylist[];
      return Array.isArray(v) ? v.slice(0, MAX_PLAYLISTS) : [];
    } catch {
      return [];
    }
  }

  private save(v: SavedPlaylist[]): void {
    try {
      this.store?.setItem(KEY, JSON.stringify(v));
    } catch {
      /* без хранилища — до перезагрузки */
    }
  }

  /** Добавить по ссылке. Ошибка: 'bad' — не ссылка на плейлист, 'full' — уже 10, 'dup' — уже есть. */
  add(input: string, title?: string): SavedPlaylist | 'bad' | 'full' | 'dup' {
    const id = parsePlaylistId(input);
    if (!id) return 'bad';
    const cur = this.list();
    if (cur.some((p) => p.id === id)) return 'dup';
    if (cur.length >= MAX_PLAYLISTS) return 'full';
    const p = { id, title: (title?.trim() || id).slice(0, 60) };
    this.save([...cur, p]);
    return p;
  }

  remove(id: string): void {
    this.save(this.list().filter((p) => p.id !== id));
  }
}
