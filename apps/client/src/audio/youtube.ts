/**
 * YouTube — только официальный IFrame Player API (PLAN_V2, фаза 8):
 * - плеер всегда видим, не меньше 200×200, штатные элементы управления и реклама не скрыты;
 *   наши кнопки — под плеером, не поверх;
 * - без отделения звука от видео: плеер свёрнут, вкладка скрыта или плеер виден меньше
 *   чем наполовину — пауза;
 * - автозапуск только когда плеер виден больше чем наполовину; плеер на странице один;
 * - встраивание проверяется заранее через YouTube Data API (если задан ключ
 *   VITE_YT_API_KEY), иначе недоступные ролики пропускаются по ошибке плеера.
 */
import { t } from '@sr/shared';

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  nextVideo(): void;
  previousVideo(): void;
  setVolume(v: number): void;
  loadPlaylist(arg: string[] | { list: string; listType: 'playlist' }): void;
  cuePlaylist(arg: string[] | { list: string; listType: 'playlist' }): void;
  getVideoData?(): { title?: string };
  destroy(): void;
}
interface YTEvent {
  data: number;
  target: YTPlayer;
}
export interface YTApi {
  Player: new (
    el: HTMLElement,
    opts: {
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: Record<string, (e: YTEvent) => void>;
    },
  ) => YTPlayer;
}

/** Состояния плеера (YT.PlayerState). */
const PLAYING = 1;
/** Ошибки «ролик недоступен / встраивание запрещено / не найден». */
const SKIPPABLE = new Set([2, 5, 100, 101, 150]);

/** Подгрузить официальный скрипт iframe_api; не успел за timeoutMs — ошибка (8.5). */
export function loadYouTubeApi(timeoutMs = 5000): Promise<YTApi> {
  const w = window as unknown as {
    YT?: YTApi & { loaded?: number };
    onYouTubeIframeAPIReady?: () => void;
  };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('youtube timeout')), timeoutMs);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      clearTimeout(timer);
      resolve(w.YT!);
    };
    if (!document.querySelector('script[data-yt-api]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.dataset.ytApi = '1';
      s.onerror = () => {
        clearTimeout(timer);
        s.remove();
        reject(new Error('youtube blocked'));
      };
      document.head.appendChild(s);
    }
  });
}

/** Ролики плейлиста, которые можно встраивать (Data API v3). null — проверка недоступна. */
export async function embeddableVideos(listId: string, key: string): Promise<string[] | null> {
  const base = 'https://www.googleapis.com/youtube/v3';
  const items = await fetch(
    `${base}/playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(listId)}&key=${encodeURIComponent(key)}`,
  );
  if (items.status === 404) return [];
  if (!items.ok) return null;
  const ids = ((await items.json()) as { items?: { contentDetails: { videoId: string } }[] }).items
    ?.map((i) => i.contentDetails.videoId)
    .filter(Boolean);
  if (!ids?.length) return [];
  const vids = await fetch(
    `${base}/videos?part=status&id=${ids.join(',')}&key=${encodeURIComponent(key)}`,
  );
  if (!vids.ok) return null;
  const st = (
    (await vids.json()) as {
      items?: { id: string; status: { embeddable: boolean; privacyStatus: string } }[];
    }
  ).items;
  const ok = new Set(
    st?.filter((v) => v.status.embeddable && v.status.privacyStatus !== 'private').map((v) => v.id),
  );
  return ids.filter((id) => ok.has(id));
}

/**
 * Решение «можно ли играть» — чистая функция (тесты): развёрнут, вкладка видна,
 * плеер виден хотя бы наполовину.
 */
export function mayPlay(s: { collapsed: boolean; hidden: boolean; ratio: number }): boolean {
  return !s.collapsed && !s.hidden && s.ratio >= 0.5;
}

export interface YouTubeDeps {
  load: (timeoutMs: number) => Promise<YTApi>;
  apiKey?: string;
}

/** Карточка-плеер в углу экрана. Один экземпляр на страницу. */
export class YouTubeSource {
  readonly card: HTMLDivElement;
  private frame: HTMLDivElement;
  private titleEl: HTMLElement;
  private player: YTPlayer | null = null;
  private api: YTApi | null = null;
  private ratio = 0;
  private wantPlay = false;
  private errors = 0;
  private volume = 60;
  listId: string | null = null;
  title = '';
  playing = false;
  collapsed = false;
  onChange: () => void = () => {};
  /** Плейлист не играет целиком (удалён, закрыт, всё запрещено к встраиванию). */
  onFail: (listId: string) => void = () => {};

  constructor(
    parent: HTMLElement,
    private deps: YouTubeDeps = {
      load: loadYouTubeApi,
      apiKey: (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_YT_API_KEY,
    },
  ) {
    this.card = document.createElement('div');
    this.card.className = 'yt-card hidden';
    this.card.innerHTML = `<div class="yt-frame"><div data-k="player"></div></div>
      <div class="yt-bar">
        <span class="yt-title" data-k="title"></span>
        <button class="mbtn" data-k="fold" title="${t('yt.fold')}">▾</button>
        <button class="mbtn" data-k="close" title="${t('yt.close')}">✕</button>
      </div>`;
    parent.appendChild(this.card);
    this.frame = this.card.querySelector('.yt-frame') as HTMLDivElement;
    this.titleEl = this.card.querySelector('[data-k="title"]') as HTMLElement;
    (this.card.querySelector('[data-k="fold"]') as HTMLElement).onclick = () =>
      this.setCollapsed(!this.collapsed);
    (this.card.querySelector('[data-k="close"]') as HTMLElement).onclick = () => this.close();
    if (typeof IntersectionObserver !== 'undefined')
      new IntersectionObserver(
        (es) => {
          for (const e of es) this.ratio = e.isIntersecting ? e.intersectionRatio : 0;
          this.sync();
        },
        { threshold: [0, 0.25, 0.5, 0.75, 1] },
      ).observe(this.frame);
    else this.ratio = 1;
    document.addEventListener('visibilitychange', () => this.sync());
  }

  get open(): boolean {
    return !this.card.classList.contains('hidden');
  }

  /** Привести воспроизведение к правилам видимости. */
  private sync(): void {
    if (!this.player) return;
    const ok = mayPlay({ collapsed: this.collapsed, hidden: document.hidden, ratio: this.ratio });
    if (!ok && this.playing) this.player.pauseVideo();
    else if (ok && this.wantPlay && !this.playing) this.player.playVideo();
  }

  /** Открыть плейлист. Бросает ошибку, если YouTube не загрузился за 5 с (8.5). */
  async play(listId: string, title: string): Promise<void> {
    this.listId = listId;
    this.title = title;
    this.errors = 0;
    this.wantPlay = true;
    this.card.classList.remove('hidden');
    this.setCollapsed(false);
    this.titleEl.textContent = title;
    this.api ??= await this.deps.load(5000);
    let videos: string[] | null = null;
    if (this.deps.apiKey) {
      try {
        videos = await embeddableVideos(listId, this.deps.apiKey);
      } catch {
        videos = null;
      }
      if (videos && videos.length === 0) {
        this.fail();
        return;
      }
    }
    const arg = videos ?? { list: listId, listType: 'playlist' as const };
    if (this.player) {
      this.player.loadPlaylist(arg);
      this.sync();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('youtube player timeout')), 5000);
      const vars: Record<string, string | number> = { controls: 1, playsinline: 1, rel: 0 };
      if (!videos) Object.assign(vars, { listType: 'playlist', list: listId });
      const el = this.card.querySelector('[data-k="player"]') as HTMLElement;
      this.player = new this.api!.Player(el, {
        width: '100%',
        height: '100%',
        playerVars: vars,
        events: {
          onReady: (e) => {
            clearTimeout(timer);
            e.target.setVolume(this.volume);
            if (videos) e.target.cuePlaylist(videos);
            this.sync();
            resolve();
          },
          onStateChange: (e) => {
            this.playing = e.data === PLAYING;
            if (this.playing) this.errors = 0;
            const vt = this.player?.getVideoData?.().title;
            if (vt) this.titleEl.textContent = vt;
            // Пауза кнопкой самого плеера — тоже наше «не хочу играть»
            if (
              e.data === 2 &&
              mayPlay({ collapsed: this.collapsed, hidden: document.hidden, ratio: this.ratio })
            )
              this.wantPlay = false;
            if (this.playing) this.wantPlay = true;
            this.onChange();
          },
          onError: (e) => {
            if (!SKIPPABLE.has(e.data)) return;
            // Ролик недоступен — следующий; подряд много — плейлист не играет
            if (++this.errors > 5) this.fail();
            else e.target.nextVideo();
          },
        },
      });
    });
  }

  private fail(): void {
    const id = this.listId;
    this.close();
    if (id) this.onFail(id);
  }

  toggle(): void {
    if (!this.player) return;
    if (this.playing) {
      this.wantPlay = false;
      this.player.pauseVideo();
    } else {
      this.wantPlay = true;
      if (this.collapsed) this.setCollapsed(false);
      this.sync();
    }
  }

  pause(): void {
    this.wantPlay = false;
    this.player?.pauseVideo();
  }

  next(): void {
    this.player?.nextVideo();
  }

  prev(): void {
    this.player?.previousVideo();
  }

  setVolume(v: number): void {
    this.volume = Math.round(v * 100);
    this.player?.setVolume(this.volume);
  }

  setCollapsed(c: boolean): void {
    this.collapsed = c;
    this.card.classList.toggle('collapsed', c);
    this.sync();
    this.onChange();
  }

  close(): void {
    this.pause();
    this.card.classList.add('hidden');
    this.listId = null;
    this.onChange();
  }
}
