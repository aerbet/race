import featured from './featured.json';

export interface FeaturedPlaylist {
  /** id плейлиста YouTube (параметр list=…). */
  id: string;
  title: string;
  subtitle: string;
  title_en?: string;
  subtitle_en?: string;
}

/** Рекомендованные плейлисты YouTube (PLAN_V2 8.3). Без слов из запрещённого списка — см. тест. */
export const FEATURED_PLAYLISTS = featured as FeaturedPlaylist[];

/** Допустимый id плейлиста YouTube. */
export const PLAYLIST_ID = /^[A-Za-z0-9_-]{12,64}$/;

/**
 * Достать id плейлиста из ссылки или принять сам id.
 * Поддерживает youtube.com/playlist?list=…, watch?v=…&list=…, music.youtube.com, youtu.be/…?list=….
 */
export function parsePlaylistId(input: string): string | null {
  const s = input.trim();
  if (PLAYLIST_ID.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s.includes('://') ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  if (host !== 'youtube.com' && host !== 'youtu.be' && host !== 'youtube-nocookie.com') return null;
  const list = url.searchParams.get('list');
  return list && PLAYLIST_ID.test(list) ? list : null;
}
