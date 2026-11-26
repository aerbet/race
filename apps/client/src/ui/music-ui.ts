import { t } from '@sr/shared';
import { hub } from '../audio/hub';
import { YouTubeSource } from '../audio/youtube';

/**
 * Мини-плеер: ♪ — меню «Музыка», ⏮ ⏯ ⏭ и громкость — для текущего источника
 * (радио игры, свои файлы или YouTube). M — пауза/воспроизведение.
 * Карточка YouTube — отдельный элемент рядом, наши кнопки её не перекрывают.
 */
export class MusicWidget {
  readonly el: HTMLDivElement;

  constructor(parent: HTMLElement, openMenu: () => void) {
    hub.attachYouTube(new YouTubeSource(parent));
    this.el = document.createElement('div');
    this.el.className = 'music';
    this.el.innerHTML = `
      <button class="mbtn" data-k="pick" title="${t('menu.music')}">♪</button>
      <span class="mname" data-k="name"></span>
      <button class="mbtn" data-k="prev" title="${t('music.prev')}">⏮</button>
      <button class="mbtn" data-k="play" title="${t('music.play')}">⏯</button>
      <button class="mbtn" data-k="next" title="${t('music.next')}">⏭</button>
      <input type="range" min="0" max="1" step="0.05" value="0.6" data-k="vol" title="${t('music.volume')}" />`;
    parent.appendChild(this.el);
    const q = <T extends HTMLElement>(k: string) => this.el.querySelector(`[data-k="${k}"]`) as T;
    q('pick').onclick = openMenu;
    q('name').onclick = openMenu;
    q('prev').onclick = () => hub.prev();
    q('play').onclick = () => hub.toggle();
    q('next').onclick = () => hub.next();
    q<HTMLInputElement>('vol').oninput = (e) =>
      hub.setVolume(Number((e.target as HTMLInputElement).value));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) hub.toggle();
    });
    hub.subscribe(() => this.render());
    this.render();
  }

  private render(): void {
    (this.el.querySelector('[data-k="name"]') as HTMLElement).textContent = hub.title;
    this.el.classList.toggle('has', hub.ready);
    this.el.classList.toggle('on', hub.playing);
  }
}
