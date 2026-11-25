import {
  CARS,
  Msg,
  PROTOCOL_VERSION,
  type LobbyMsg,
  type ServerMsg,
  type WelcomeMsg,
} from '@sr/shared';
import type { App } from '../app';
import { loadSettings } from '../ui/menu';
import { escapeHtml } from '../ui/menu';
import { NetClient } from './client';
import { OnlineRace } from './online-race';

function h(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

/** Экран онлайн-режима: быстрый поиск, приватная комната по ссылке, лобби. */
export function startOnline(app: App): void {
  app.closeScreens();
  app.endRace();
  const params = new URLSearchParams(location.search);
  const roomFromUrl = params.get('room');
  const root = app.root;
  let screen: HTMLElement | null = null;
  const show = (el: HTMLElement) => {
    screen?.remove();
    screen = el;
    root.appendChild(el);
    el.querySelectorAll('input').forEach((i) =>
      i.addEventListener('keydown', (e) => e.stopPropagation()),
    );
  };
  const close = () => {
    screen?.remove();
    screen = null;
  };

  const chooser = () => {
    const el = h(`<div class="screen"><div class="menu panel">
      <p class="big" style="font:900 italic 36px var(--font);margin:0">Онлайн</p>
      <p class="sub">До 8 игроков. Если за 30 с никто не подключился — добавятся боты.</p>
      <div class="btnrow" style="flex-direction:column">
        <button class="btn" data-k="quick">Быстрая игра<small>Случайная открытая комната</small></button>
        <button class="btn" data-k="create">Создать приватную комнату<small>Получите ссылку для друзей</small></button>
      </div>
      <h2>Код комнаты</h2>
      <div class="row"><input type="text" maxlength="6" data-k="code" placeholder="ABC123" style="flex:1;text-transform:uppercase" />
      <button class="btn" data-k="join">Войти</button></div>
      <div class="btnrow"><button class="btn" data-k="back">Назад</button></div>
      <p class="hint">Тест плохой сети: добавьте к адресу <span class="kbd">?lag=150&amp;jitter=30&amp;loss=2</span></p>
    </div></div>`);
    show(el);
    const q = (k: string) => el.querySelector(`[data-k="${k}"]`) as HTMLElement;
    q('quick').onclick = () => connect('quick', '');
    q('create').onclick = () => connect('create', '');
    q('join').onclick = () =>
      connect('join', (q('code') as HTMLInputElement).value.trim().toUpperCase());
    q('back').onclick = () => {
      close();
      app.menu();
    };
  };

  const connect = async (mode: 'quick' | 'create' | 'join', code: string) => {
    const settings = loadSettings();
    show(
      h(`<div class="screen"><div class="menu panel"><p class="sub">Подключение…</p></div></div>`),
    );
    const net = new NetClient();
    let welcome: WelcomeMsg | null = null;
    let lobby: LobbyMsg | null = null;
    let race: OnlineRace | null = null;
    let ready = false;

    const fail = (text: string) => {
      race = null;
      app.endRace();
      const el =
        h(`<div class="screen"><div class="menu panel"><p class="big" style="font:800 24px var(--font)">Не удалось</p>
        <p class="sub">${escapeHtml(text)}</p><div class="btnrow"><button class="btn" data-k="back">Назад</button></div></div></div>`);
      show(el);
      (el.querySelector('[data-k="back"]') as HTMLElement).onclick = chooser;
    };

    net.onClose = (reason) => {
      if (race && !race.done) fail(`Соединение потеряно: ${reason}`);
    };

    const renderLobby = () => {
      if (!welcome || !lobby) return;
      const link = `${location.origin}${location.pathname}?room=${welcome.room}`;
      const isHost = lobby.hostId === welcome.playerId;
      const rows = lobby.players
        .map(
          (p) =>
            `<tr class="${p.id === welcome!.playerId ? 'me' : ''}"><td>${escapeHtml(p.name)}${p.bot ? ' (бот)' : ''}${
              p.id === lobby!.hostId ? ' ★' : ''
            }</td><td>${escapeHtml(CARS[p.carId]?.name ?? p.carId)}</td><td>${p.ready ? 'готов' : '…'}</td></tr>`,
        )
        .join('');
      const el = h(`<div class="screen"><div class="menu panel results">
        <p class="big" style="font:900 italic 30px var(--font);margin:0">Комната ${welcome.room}</p>
        <p class="sub">${lobby.phase === 'lobby' ? `Боты через ${Math.ceil(lobby.timer)} с` : 'Старт!'} · пинг ${Math.round(net.rtt)} мс · протокол v${PROTOCOL_VERSION}</p>
        <table><tr><th>Гонщик</th><th>Машина</th><th></th></tr>${rows}</table>
        <h2>Ссылка для друзей</h2>
        <div class="row"><input type="text" readonly value="${link}" style="flex:1" data-k="link"/><button class="btn" data-k="copy">Копировать</button></div>
        <div class="btnrow">
          <button class="btn ${ready ? 'sel' : ''}" data-k="ready">${ready ? 'Готов ✓' : 'Готов'}</button>
          ${isHost ? '<button class="btn" data-k="start">Старт сейчас (с ботами)</button>' : ''}
          <button class="btn" data-k="leave">Выйти</button>
        </div></div></div>`);
      show(el);
      const q = (k: string) => el.querySelector(`[data-k="${k}"]`) as HTMLElement | null;
      q('copy')!.onclick = () => void navigator.clipboard?.writeText(link);
      q('ready')!.onclick = () => {
        ready = !ready;
        net.send({ type: Msg.Ready, ready });
        renderLobby();
      };
      if (q('start')) q('start')!.onclick = () => net.send({ type: Msg.StartNow });
      q('leave')!.onclick = () => {
        net.close();
        chooser();
      };
    };

    net.onMessage = (m: ServerMsg) => {
      if (m.type === Msg.Error) return fail(m.message);
      if (m.type === Msg.Welcome) {
        welcome = m;
        history.replaceState(
          null,
          '',
          `?room=${m.room}${location.search.replace(/^\?/, '&').replace(/&?room=[^&]*/, '')}`,
        );
        return;
      }
      if (m.type === Msg.Lobby) {
        lobby = m;
        if (m.phase === 'lobby') renderLobby();
        if (m.phase === 'countdown' && !race && welcome) {
          close();
          const slot = m.players.findIndex((p) => p.id === welcome!.playerId);
          race = new OnlineRace(
            app.R,
            {
              mode: 'circuit',
              trackId: welcome.trackId,
              carId: settings.carId,
              bots: 0,
              botLevel: 'medium',
              laps: welcome.laps,
              manual: settings.manual,
              playerName: settings.playerName,
              slot,
            },
            app.quality,
            app.root,
            app.input,
            net,
            welcome.playerId,
            m.players,
          );
          app.attach(race, {
            online: true,
            onResults: (r) => {
              net.close();
              setTimeout(() => app.showResultsPublic(r, () => startOnline(app)), 600);
            },
          });
          race.session.start();
        }
        return;
      }
      race?.onServer(m);
    };

    try {
      await net.opened();
    } catch {
      return fail('Сервер гонок недоступен. Запустите его: pnpm --filter race-server dev');
    }
    net.send({
      type: Msg.Hello,
      version: PROTOCOL_VERSION,
      name: settings.playerName,
      carId: settings.carId,
      mode,
      room: code,
    });
  };

  if (roomFromUrl) void connect('join', roomFromUrl.toUpperCase());
  else chooser();
}
