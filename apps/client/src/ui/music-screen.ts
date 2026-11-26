import { FEATURED_PLAYLISTS, getLang, t, tn } from '@sr/shared';
import { brokenPlaylists, hub, type MusicSource } from '../audio/hub';
import { music } from '../audio/music';
import { MAX_PLAYLISTS, PlaylistStore } from '../audio/playlists';
import { radio } from '../audio/radio';
import { escapeHtml } from './menu';

const store = new PlaylistStore();

/** Меню «Музыка» (8.4): Радио игры · Мои файлы · YouTube и режим стримера. */
export function showMusic(root: HTMLElement, done: () => void): void {
  const el = document.createElement('div');
  el.className = 'screen meta';
  el.innerHTML = `<div class="menu panel music-screen" data-k="panel"></div>`;
  root.appendChild(el);
  const panel = el.querySelector('[data-k="panel"]') as HTMLElement;
  let tab: MusicSource = hub.source ?? 'radio';
  if (tab === 'youtube' && hub.streamer) tab = 'radio';
  let msg = '';
  const unsub = hub.subscribe(() => render());
  const prevNotice = hub.onNotice;
  const close = () => {
    unsub();
    hub.onNotice = prevNotice;
    el.remove();
    done();
  };
  const $ = <T extends HTMLElement = HTMLElement>(k: string) =>
    panel.querySelector(`[data-k="${k}"]`) as T;
  const all = <T extends HTMLElement = HTMLElement>(sel: string) => panel.querySelectorAll<T>(sel);

  const radioTab = () => {
    const on = hub.source === 'radio' && radio.playing;
    return `<p class="sub">${t('radio.sub')}</p>
      <div class="btnrow">
        <button class="btn ${on ? 'sel' : ''}" data-k="radio">${on ? t('radio.pause') : t('radio.play')}<small>${t('radio.track', { n: String(radio.track.seed).padStart(2, '0') })}</small></button>
        <button class="btn" data-k="radioNext">${t('radio.next')}</button>
      </div>`;
  };

  const filesTab = () => `<p class="sub">${t('files.sub')}</p>
      <div class="btnrow">
        ${music.supportsFolder ? `<button class="btn" data-k="folder">${t('files.folder')}</button>` : ''}
        <button class="btn" data-k="files">${t('files.pick')}</button>
        ${music.tracks.length ? `<button class="btn ${hub.source === 'files' && music.playing ? 'sel' : ''}" data-k="filesPlay">${tn('music.tracks', music.tracks.length)}</button>` : ''}
      </div>
      <input type="file" accept="audio/*" multiple hidden data-k="file" />`;

  const ytTab = () => {
    if (hub.streamer) return `<p class="sub">${t('yt.streamerOff')}</p>`;
    const en = getLang() === 'en';
    const featured = FEATURED_PLAYLISTS.filter((p) => !brokenPlaylists.has(p.id))
      .map(
        (p) =>
          `<button class="btn ${hub.youtube?.listId === p.id ? 'sel' : ''}" data-play="${p.id}" data-title="${escapeHtml(en ? (p.title_en ?? p.title) : p.title)}">${escapeHtml(en ? (p.title_en ?? p.title) : p.title)}<small>${escapeHtml(en ? (p.subtitle_en ?? p.subtitle) : p.subtitle)}</small></button>`,
      )
      .join('');
    const mine = store
      .list()
      .map(
        (p) =>
          `<div class="row yt-row"><button class="btn ${hub.youtube?.listId === p.id ? 'sel' : ''}" data-play="${p.id}" data-title="${escapeHtml(p.title)}" style="flex:1">${escapeHtml(p.title)}</button><button class="btn" data-del="${p.id}" title="${t('yt.remove')}">✕</button></div>`,
      )
      .join('');
    return `${featured ? `<h2>${t('yt.featured')}</h2><div class="grid2">${featured}</div>` : ''}
      <h2>${t('yt.mine')} (${store.list().length}/${MAX_PLAYLISTS})</h2>
      ${mine}
      <div class="row"><input type="text" data-k="url" placeholder="${t('yt.paste')}" style="flex:1" /><button class="btn" data-k="add">${t('yt.add')}</button></div>`;
  };

  const render = () => {
    // Перерисовка по событиям плеера не должна стирать недописанную ссылку
    const typed = panel.querySelector<HTMLInputElement>('[data-k="url"]')?.value ?? '';
    const tabs: [MusicSource, string][] = [
      ['radio', t('music.tab.radio')],
      ['files', t('music.tab.files')],
      ['youtube', 'YouTube'],
    ];
    panel.innerHTML = `<p class="big" style="font:900 italic 30px var(--font);margin:0">${t('menu.music')}</p>
      <div class="row">${tabs
        .map(
          ([id, name]) =>
            `<button class="btn ${tab === id ? 'sel' : ''}" data-tab="${id}" ${id === 'youtube' && hub.streamer ? 'disabled' : ''}>${name}</button>`,
        )
        .join('')}</div>
      <div data-k="body">${tab === 'radio' ? radioTab() : tab === 'files' ? filesTab() : ytTab()}</div>
      <p class="sub" data-k="msg">${escapeHtml(msg)}</p>
      <h2>${t('streamer.title')}</h2>
      <div class="row"><button class="btn ${hub.streamer ? 'sel' : ''}" data-k="streamer">${hub.streamer ? t('streamer.on') : t('streamer.off')}<small>${t('streamer.sub')}</small></button></div>
      <div class="btnrow"><button class="btn" data-k="back">${t('ui.done')}</button></div>`;
    panel
      .querySelectorAll('input')
      .forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    all('[data-tab]').forEach((b) => {
      b.onclick = () => {
        tab = b.dataset.tab as MusicSource;
        msg = '';
        render();
      };
    });
    $('back').onclick = close;
    $('streamer').onclick = () => hub.setStreamer(!hub.streamer);
    if (tab === 'radio') {
      $('radio').onclick = () => (hub.source === 'radio' ? hub.toggle() : hub.playRadio());
      $('radioNext').onclick = () => {
        if (hub.source !== 'radio') hub.playRadio();
        radio.next();
      };
    }
    if (tab === 'files') {
      const file = $<HTMLInputElement>('file');
      const start = (n: number) => {
        if (n > 0) {
          hub.select('files');
          if (!music.playing) music.toggle();
        }
        render();
      };
      $('folder')?.addEventListener('click', async () => {
        try {
          start(await music.pickFolder());
        } catch {
          file.click();
        }
      });
      $('files').onclick = () => file.click();
      file.onchange = () => file.files && start(music.addFiles(file.files));
      $('filesPlay')?.addEventListener('click', () => {
        if (hub.source !== 'files') hub.select('files');
        music.toggle();
      });
    }
    if (tab === 'youtube' && !hub.streamer) {
      all('[data-play]').forEach((b) => {
        b.onclick = () => void hub.playYouTube(b.dataset.play!, b.dataset.title ?? '');
      });
      all('[data-del]').forEach((b) => {
        b.onclick = () => {
          store.remove(b.dataset.del!);
          render();
        };
      });
      const url = $<HTMLInputElement>('url');
      url.value = typed;
      $('add').onclick = () => {
        const r = store.add(url.value);
        if (typeof r !== 'string') url.value = '';
        msg = typeof r === 'string' ? t(`yt.err.${r}`) : '';
        if (typeof r !== 'string') void hub.playYouTube(r.id, r.title);
        render();
      };
    }
  };
  hub.onNotice = (text) => {
    msg = text;
    render();
  };
  render();
}
