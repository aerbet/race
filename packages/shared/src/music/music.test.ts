import { describe, expect, it } from 'vitest';
import { FEATURED_PLAYLISTS, parsePlaylistId } from './index';

describe('YouTube-плейлисты (8.2, 8.3)', () => {
  it('разбор ссылки', () => {
    const id = 'PLDE0DBBFAA8E2F771';
    expect(parsePlaylistId(`https://www.youtube.com/playlist?list=${id}`)).toBe(id);
    expect(parsePlaylistId(`https://youtube.com/watch?v=abcdefghijk&list=${id}&index=3`)).toBe(id);
    expect(parsePlaylistId(`https://music.youtube.com/playlist?list=${id}`)).toBe(id);
    expect(parsePlaylistId(`youtu.be/abcdefghijk?list=${id}`)).toBe(id);
    expect(parsePlaylistId(`m.youtube.com/playlist?list=${id}`)).toBe(id);
    expect(parsePlaylistId(`  ${id}  `)).toBe(id);
    expect(parsePlaylistId('https://example.com/playlist?list=PLDE0DBBFAA8E2F771')).toBeNull();
    expect(parsePlaylistId('https://youtube.com/watch?v=abcdefghijk')).toBeNull();
    expect(parsePlaylistId('https://youtube.com/playlist?list=<script>')).toBeNull();
    expect(parsePlaylistId('привет')).toBeNull();
  });

  it('рекомендованные: первый — классика 2004, без запрещённых слов', () => {
    expect(FEATURED_PLAYLISTS[0]).toMatchObject({
      id: 'PLDE0DBBFAA8E2F771',
      title: 'Гоночная классика 2004',
      subtitle: 'Тот самый саундтрек',
    });
    const all = JSON.stringify(FEATURED_PLAYLISTS).toLowerCase();
    for (const w of ['need for speed', 'nfs', 'underground']) expect(all).not.toContain(w);
  });
});
