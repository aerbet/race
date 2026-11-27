/**
 * Музыкальный центр (8.4): один активный источник — радио игры, свои файлы или YouTube.
 * Мини-плеер и экран «Музыка» управляют музыкой только через него.
 */
import { t } from '@sr/shared';
import { music } from './music';
import { radio } from './radio';
import type { YouTubeSource } from './youtube';

export type MusicSource = 'radio' | 'files' | 'youtube';

const SRC_KEY = 'sr:music-src';
const STREAMER_KEY = 'sr:streamer';

function read(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function write(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* без хранилища */
  }
}

/** Плейлисты, которые в этой сессии не заиграли (8.3: карточка скрывается). */
export const brokenPlaylists = new Set<string>();

export class MusicHub {
  source: MusicSource | null = null;
  streamer = read(STREAMER_KEY) === '1';
  youtube: YouTubeSource | null = null;
  private volume = 0.6;
  private listeners = new Set<() => void>();
  /** Короткое сообщение игроку (запасной вариант 8.5 и т. п.). */
  onNotice: (text: string) => void = () => {};

  constructor() {
    radio.onChange = () => this.emit();
    music.onChange = () => this.emit();
    const saved = read(SRC_KEY);
    if (saved === 'radio' || saved === 'files') this.source = saved;
  }

  attachYouTube(yt: YouTubeSource): void {
    this.youtube = yt;
    yt.onChange = () => this.emit();
    yt.onFail = (id) => {
      brokenPlaylists.add(id);
      this.onNotice(t('yt.listFailed'));
      this.fallback();
    };
  }

  subscribe(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit(): void {
    for (const f of this.listeners) f();
  }

  /** Остановить всё, кроме выбранного источника. */
  private stopOthers(keep: MusicSource | null): void {
    if (keep !== 'radio') radio.pause();
    if (keep !== 'files' && music.playing) music.toggle();
    if (keep !== 'youtube') this.youtube?.close();
  }

  select(src: MusicSource): void {
    this.stopOthers(src);
    this.source = src;
    if (src !== 'youtube') write(SRC_KEY, src);
    this.emit();
  }

  playRadio(): void {
    this.select('radio');
    radio.setVolume(this.volume);
    radio.play();
  }

  /** YouTube; не загрузился за 5 с — сообщение и радио (8.5). */
  async playYouTube(listId: string, title: string): Promise<void> {
    if (this.streamer || !this.youtube) return;
    this.select('youtube');
    this.youtube.setVolume(this.volume);
    try {
      await this.youtube.play(listId, title);
    } catch {
      this.onNotice(t('yt.down'));
      this.fallback();
    }
  }

  private fallback(): void {
    this.youtube?.close();
    this.playRadio();
  }

  /** Игрок переключил режим стримера — синхронизация с профилем. */
  onStreamerChange: ((on: boolean) => void) | null = null;

  setStreamer(on: boolean, fromProfile = false): void {
    if (!fromProfile && on !== this.streamer) this.onStreamerChange?.(on);
    this.streamer = on;
    write(STREAMER_KEY, on ? '1' : '0');
    if (on && this.source === 'youtube') this.fallback();
    this.emit();
  }

  get playing(): boolean {
    if (this.source === 'radio') return radio.playing;
    if (this.source === 'files') return music.playing;
    if (this.source === 'youtube') return !!this.youtube?.playing;
    return false;
  }

  /** Подпись для мини-плеера. */
  get title(): string {
    if (this.source === 'radio')
      return t('radio.track', { n: String(radio.track.seed).padStart(2, '0') });
    if (this.source === 'files') {
      const cur = music.current;
      return cur ? cur.name.replace(/\.[^.]+$/, '') : t('music.own');
    }
    if (this.source === 'youtube') return this.youtube?.title || 'YouTube';
    return t('menu.music');
  }

  /** Есть что играть кнопкой ⏯ без захода в меню «Музыка». */
  get ready(): boolean {
    if (this.source === 'files') return music.tracks.length > 0;
    if (this.source === 'youtube') return !!this.youtube?.open;
    return this.source === 'radio';
  }

  toggle(): void {
    if (this.source === 'radio') {
      radio.setVolume(this.volume);
      radio.toggle();
    } else if (this.source === 'files') music.toggle();
    else if (this.source === 'youtube') this.youtube?.toggle();
  }

  next(): void {
    if (this.source === 'radio') radio.next();
    else if (this.source === 'files') music.next();
    else if (this.source === 'youtube') this.youtube?.next();
  }

  prev(): void {
    if (this.source === 'radio') radio.prev();
    else if (this.source === 'files') music.prev();
    else if (this.source === 'youtube') this.youtube?.prev();
  }

  setVolume(v: number): void {
    this.volume = v;
    radio.setVolume(v);
    music.setVolume(v);
    this.youtube?.setVolume(v);
  }
}

export const hub = new MusicHub();
