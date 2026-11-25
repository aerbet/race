/**
 * Плеер своей музыки. Файлы выбираются через File System Access API (папка) или
 * <input type="file">, играются только локально через object URL — на сервер
 * ничего не отправляется (юридическое требование ТЗ).
 */
export interface Track {
  name: string;
  file: File;
}

const AUDIO_EXT = /\.(mp3|ogg|oga|opus|m4a|aac|flac|wav|webm)$/i;

export class MusicPlayer {
  readonly audio = new Audio();
  tracks: Track[] = [];
  order: number[] = [];
  pos = -1;
  shuffle = false;
  private url: string | null = null;
  onChange: () => void = () => {};

  constructor() {
    this.audio.preload = 'auto';
    this.audio.volume = 0.6;
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('play', () => this.onChange());
    this.audio.addEventListener('pause', () => this.onChange());
  }

  get current(): Track | null {
    const i = this.order[this.pos];
    return i === undefined ? null : (this.tracks[i] ?? null);
  }

  get playing(): boolean {
    return !this.audio.paused;
  }

  get supportsFolder(): boolean {
    return 'showDirectoryPicker' in window;
  }

  /** Выбрать папку (File System Access API), рекурсивно собрать аудиофайлы. */
  async pickFolder(): Promise<number> {
    const picker = (
      window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker;
    const dir = await picker();
    const files: Track[] = [];
    const walk = async (d: FileSystemDirectoryHandle, depth: number) => {
      for await (const entry of (
        d as unknown as { values: () => AsyncIterable<FileSystemHandle> }
      ).values()) {
        if (entry.kind === 'file' && AUDIO_EXT.test(entry.name)) {
          files.push({ name: entry.name, file: await (entry as FileSystemFileHandle).getFile() });
        } else if (entry.kind === 'directory' && depth < 3) {
          await walk(entry as FileSystemDirectoryHandle, depth + 1);
        }
      }
    };
    await walk(dir, 0);
    this.setTracks(files);
    return files.length;
  }

  /** Запасной путь: обычный выбор файлов. */
  addFiles(list: FileList | File[]): number {
    const files = Array.from(list)
      .filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name))
      .map((f) => ({ name: f.name, file: f }));
    this.setTracks([...this.tracks, ...files]);
    return files.length;
  }

  private setTracks(t: Track[]): void {
    this.tracks = t.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    this.reorder();
    this.pos = -1;
    this.onChange();
  }

  private reorder(): void {
    const idx = this.tracks.map((_, i) => i);
    if (this.shuffle) {
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [idx[i], idx[j]] = [idx[j]!, idx[i]!];
      }
    }
    // Текущий трек остаётся текущим
    const cur = this.order[this.pos];
    this.order = idx;
    if (cur !== undefined) this.pos = this.order.indexOf(cur);
  }

  toggleShuffle(): void {
    this.shuffle = !this.shuffle;
    this.reorder();
    this.onChange();
  }

  private load(pos: number): void {
    if (this.tracks.length === 0) return;
    this.pos = ((pos % this.order.length) + this.order.length) % this.order.length;
    const t = this.current!;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(t.file);
    this.audio.src = this.url;
    void this.audio.play().catch(() => {});
    this.onChange();
  }

  toggle(): void {
    if (this.tracks.length === 0) return;
    if (this.pos < 0) return this.load(0);
    if (this.audio.paused) void this.audio.play().catch(() => {});
    else this.audio.pause();
  }

  next(): void {
    this.load(this.pos + 1);
  }

  prev(): void {
    if (this.audio.currentTime > 3) this.audio.currentTime = 0;
    else this.load(this.pos - 1);
  }

  setVolume(v: number): void {
    this.audio.volume = Math.max(0, Math.min(1, v));
  }
}

export const music = new MusicPlayer();
