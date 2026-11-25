import {
  CARS,
  Msg,
  PROTOCOL_VERSION,
  type City,
  type LobbyMsg,
  type ServerMsg,
  type WelcomeMsg,
} from '@sr/shared';
import type { App } from '../app';
import { loadSettings } from '../ui/menu';
import { escapeHtml } from '../ui/menu';
import { NetClient } from './client';
import { OnlineRace } from './online-race';
import { account } from '../meta/account';
import { activeCar } from '../meta/api';

/** Совпадает с серверным CHALLENGE_RANGE. */
const CHALLENGE_RANGE_CLIENT = 45;

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
        <button class="btn" data-k="freeroam">Свободная езда: Москва<small>До 16 игроков · мигните фарами (H) рядом с соперником, чтобы вызвать на гонку</small></button>
        <button class="btn" data-k="freeroam_tyo">Свободная езда: Токио<small>Неоновый квартал, вызов фарами (H)</small></button>
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
    q('freeroam').onclick = () => connect('freeroam', 'moscow_synth');
    q('freeroam_tyo').onclick = () => connect('freeroam', 'tokyo_synth');
    q('join').onclick = () =>
      connect('join', (q('code') as HTMLInputElement).value.trim().toUpperCase());
    q('back').onclick = () => {
      close();
      app.menu();
    };
  };

  const connect = async (
    mode: 'quick' | 'create' | 'join' | 'freeroam',
    code: string,
    opts: { autoReady?: boolean } = {},
  ) => {
    const settings = loadSettings();
    show(
      h(`<div class="screen"><div class="menu panel"><p class="sub">Подключение…</p></div></div>`),
    );
    const net = new NetClient();
    let welcome: WelcomeMsg | null = null;
    let lobby: LobbyMsg | null = null;
    let race: OnlineRace | null = null;
    let ready = false;
    let city: City | null = null;
    let inviteEl: HTMLElement | null = null;
    let pendingInvite: { from: number } | null = null;
    const freeroam = mode === 'freeroam';

    const reply = (accept: boolean) => {
      if (!pendingInvite) return;
      net.send({ type: Msg.ChallengeReply, from: pendingInvite.from, accept });
      pendingInvite = null;
      inviteEl?.remove();
      inviteEl = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!race || !freeroam) return;
      if (e.code === 'KeyH') {
        race.flashLights();
        const t = race.nearestAhead(CHALLENGE_RANGE_CLIENT);
        if (t) {
          net.send({ type: Msg.Challenge, target: t.id });
          app.toast(`Вызов отправлен: ${t.name}`);
        }
      }
      if (e.code === 'KeyY') reply(true);
      if (e.code === 'KeyN') reply(false);
    };
    window.addEventListener('keydown', onKey);
    const cleanup = () => {
      window.removeEventListener('keydown', onKey);
      inviteEl?.remove();
    };

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
      cleanup();
      if (race && !race.done && !switching) fail(`Соединение потеряно: ${reason}`);
    };
    let switching = false;

    // Машина из гаража (если вошли) — тюнинг и окраска
    const garageCar = await activeCar().catch(() => null);
    if (garageCar) account.ownedCarId = garageCar.id;
    const makeRace = (players: LobbyMsg['players']) => {
      const w = welcome!;
      const slot = freeroam ? w.playerId % 8 : players.findIndex((p) => p.id === w.playerId);
      race = new OnlineRace(
        app.R,
        {
          mode: freeroam ? 'free' : 'circuit',
          trackId: w.trackId,
          carId: garageCar?.carId ?? settings.carId,
          parts: garageCar?.parts,
          paint: garageCar?.visual.paint,
          neon: garageCar?.visual.neon,
          ownedCarId: garageCar?.id,
          bots: 0,
          botLevel: 'medium',
          laps: freeroam ? 999 : w.laps,
          manual: settings.manual,
          playerName: settings.playerName,
          slot,
          cityId: w.city || undefined,
          weather: w.city ? settings.weather : 'dry',
        },
        app.quality,
        app.root,
        app.input,
        net,
        w.playerId,
        freeroam ? [] : players,
        city,
      );
      app.attach(race, {
        online: true,
        onResults: (r) => {
          cleanup();
          net.close();
          setTimeout(() => app.showResultsPublic(r, () => startOnline(app)), 600);
        },
      });
      race.session.start();
      if (freeroam) app.toast('Свободная езда · H — мигнуть фарами / вызвать на гонку', 4);
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

    const handle = async (m: ServerMsg) => {
      if (m.type === Msg.Error) return fail(m.message);
      if (m.type === Msg.Welcome) {
        welcome = m;
        if (m.city) city = await app.loadCityCached(m.city);
        if (freeroam) {
          close();
          makeRace([]);
          return;
        }
        history.replaceState(
          null,
          '',
          `?room=${m.room}${location.search.replace(/^\?/, '&').replace(/&?room=[^&]*/, '')}`,
        );
        if (opts.autoReady) {
          ready = true;
          net.send({ type: Msg.Ready, ready: true });
        }
        return;
      }
      if (m.type === Msg.ChallengeInvite) {
        pendingInvite = { from: m.from };
        inviteEl?.remove();
        inviteEl = h(`<div class="invite panel"><b>${escapeHtml(m.name)}</b> вызывает на гонку
          <div class="btnrow"><button class="btn" data-k="yes">Принять (Y)</button><button class="btn" data-k="no">Отказ (N)</button></div></div>`);
        root.appendChild(inviteEl);
        (inviteEl.querySelector('[data-k="yes"]') as HTMLElement).onclick = () => reply(true);
        (inviteEl.querySelector('[data-k="no"]') as HTMLElement).onclick = () => reply(false);
        const el = inviteEl;
        setTimeout(() => {
          if (inviteEl === el) {
            el.remove();
            inviteEl = null;
            pendingInvite = null;
          }
        }, 12000);
        return;
      }
      if (m.type === Msg.ChallengeStart) {
        switching = true;
        cleanup();
        net.close();
        app.endRace();
        app.toast('Гонка-вызов!');
        void connect('join', m.room, { autoReady: true });
        return;
      }
      if (m.type === Msg.Lobby) {
        lobby = m;
        if (m.phase === 'freeroam') {
          race?.syncPlayers(m.players);
          return;
        }
        if (m.phase === 'lobby') renderLobby();
        if (m.phase === 'countdown' && !race && welcome) {
          close();
          makeRace(m.players);
        }
        return;
      }
      race?.onServer(m);
    };
    // Сообщения обрабатываются строго по очереди (загрузка города асинхронная)
    let chain = Promise.resolve();
    net.onMessage = (m: ServerMsg) => {
      chain = chain.then(() => handle(m)).catch((e) => console.error(e));
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
      carId: garageCar?.carId ?? settings.carId,
      mode,
      room: code,
      token: account.token ?? '',
      ownedCarId: account.ownedCarId ?? '',
    });
  };

  if (roomFromUrl) void connect('join', roomFromUrl.toUpperCase());
  else chooser();
}
