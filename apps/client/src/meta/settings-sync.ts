/**
 * Настройки в профиле (PLAN_V3 11.5): язык, режим стримера и свои плейлисты YouTube
 * переезжают между устройствами вместе с аккаунтом. Без входа — как раньше, в браузере.
 */
import { getLang, setLang, type Lang } from '@sr/shared';
import { hub } from '../audio/hub';
import { PlaylistStore, type SavedPlaylist } from '../audio/playlists';
import { account } from './account';
import { api } from './api';

export interface ProfileSettings {
  lang?: Lang;
  streamer?: boolean;
  playlists?: SavedPlaylist[];
}

const LANG_KEY = 'sr:lang';

/** Отправить изменённые поля в профиль (без входа — ничего). Ошибки сети не мешают игре. */
export async function pushSettings(patch: ProfileSettings): Promise<void> {
  if (!account.token) return;
  try {
    await api('/api/me/settings', { method: 'PUT', body: patch });
  } catch {
    /* офлайн — настройка останется в браузере */
  }
}

/**
 * Применить настройки профиля к этому устройству. Пустые поля профиля заполняются
 * значениями с устройства (первый вход: свои плейлисты не теряются).
 * Возвращает true, если сменился язык (экран нужно пересобрать).
 */
export function applySettings(
  s: ProfileSettings,
  store = new PlaylistStore(),
): {
  langChanged: boolean;
  upload: ProfileSettings;
} {
  const upload: ProfileSettings = {};
  let langChanged = false;
  if (s.lang && s.lang !== getLang()) {
    setLang(s.lang);
    try {
      localStorage.setItem(LANG_KEY, s.lang);
    } catch {
      /* без хранилища */
    }
    langChanged = true;
  } else if (!s.lang) upload.lang = getLang();
  if (typeof s.streamer === 'boolean') hub.setStreamer(s.streamer, true);
  else if (hub.streamer) upload.streamer = true;
  if (s.playlists?.length) store.replace(s.playlists);
  else {
    const local = store.list();
    if (local.length) upload.playlists = local;
  }
  return { langChanged, upload };
}

/** Забрать настройки профиля (после входа и при запуске). Не ждёт дольше timeoutMs. */
export async function pullSettings(timeoutMs = 2500): Promise<boolean> {
  if (!account.token) return false;
  try {
    const s = await Promise.race([
      api<ProfileSettings>('/api/me/settings'),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    const { langChanged, upload } = applySettings(s);
    if (Object.keys(upload).length) void pushSettings(upload);
    return langChanged;
  } catch {
    return false;
  }
}

/** Изменения игрока → профиль. Вызвать один раз при запуске. */
export function initSettingsSync(): void {
  PlaylistStore.onChange = (list) => void pushSettings({ playlists: list });
  hub.onStreamerChange = (on) => void pushSettings({ streamer: on });
}
