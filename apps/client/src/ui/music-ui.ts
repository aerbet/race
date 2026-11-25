import { music } from '../audio/music';

/** Мини-плеер: выбор папки/файлов, ⏮ ⏯ ⏭, перемешивание, громкость. M — пауза/воспроизведение. */
export class MusicWidget {
  readonly el: HTMLDivElement;
  private file: HTMLInputElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'music';
    this.el.innerHTML = `
      <button class="mbtn" data-k="pick" title="Своя музыка (файлы не покидают устройство)">♪</button>
      <span class="mname" data-k="name">Своя музыка</span>
      <button class="mbtn" data-k="prev" title="Назад">⏮</button>
      <button class="mbtn" data-k="play" title="Пауза (M)">⏯</button>
      <button class="mbtn" data-k="next" title="Дальше">⏭</button>
      <button class="mbtn" data-k="shuffle" title="Перемешать">⤮</button>
      <input type="range" min="0" max="1" step="0.05" value="0.6" data-k="vol" title="Громкость" />
      <input type="file" accept="audio/*" multiple hidden data-k="file" />`;
    parent.appendChild(this.el);
    const q = <T extends HTMLElement>(k: string) => this.el.querySelector(`[data-k="${k}"]`) as T;
    this.file = q<HTMLInputElement>('file');
    q('pick').onclick = async () => {
      if (music.supportsFolder) {
        try {
          const n = await music.pickFolder();
          if (n > 0) music.toggle();
          return;
        } catch {
          /* отмена или нет доступа — откроем выбор файлов */
        }
      }
      this.file.click();
    };
    this.file.onchange = () => {
      if (this.file.files && music.addFiles(this.file.files) > 0 && !music.playing) music.toggle();
    };
    q('prev').onclick = () => music.prev();
    q('play').onclick = () => music.toggle();
    q('next').onclick = () => music.next();
    q('shuffle').onclick = () => music.toggleShuffle();
    q<HTMLInputElement>('vol').oninput = (e) =>
      music.setVolume(Number((e.target as HTMLInputElement).value));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) music.toggle();
    });
    music.onChange = () => this.render();
    this.render();
  }

  private render(): void {
    const name = this.el.querySelector('[data-k="name"]') as HTMLElement;
    const cur = music.current;
    name.textContent = cur
      ? cur.name.replace(/\.[^.]+$/, '')
      : music.tracks.length
        ? `${music.tracks.length} треков`
        : 'Своя музыка';
    this.el.classList.toggle('has', music.tracks.length > 0);
    this.el.classList.toggle('on', music.playing);
    (this.el.querySelector('[data-k="shuffle"]') as HTMLElement).classList.toggle(
      'active',
      music.shuffle,
    );
  }
}
