import {
  t,
  has,
  resolveVisual,
  CARS,
  DISPATCHER,
  PART_CATEGORIES,
  TUNING,
  TRACKS,
  applyTuning,
  computePI,
  formatTime,
  piClass,
  storyNext,
  type PartCategory,
  type Weather,
} from '@sr/shared';
import { escapeHtml, locale } from '../ui/menu';
import { account, logout, saveAccount } from './account';
import {
  api,
  errText,
  catalog,
  garageList,
  login,
  newKey,
  register,
  wallet,
  type OwnedCar,
} from './api';

function h(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

/** Модальный экран поверх меню; возвращает функцию закрытия. */
function screen(root: HTMLElement, inner: string): { el: HTMLElement; close: () => void } {
  const el = h(`<div class="screen meta"><div class="menu panel">${inner}</div></div>`);
  root.appendChild(el);
  el.querySelectorAll('input').forEach((i) =>
    i.addEventListener('keydown', (e) => e.stopPropagation()),
  );
  return { el, close: () => el.remove() };
}

const q = <T extends HTMLElement = HTMLElement>(el: HTMLElement, k: string) =>
  el.querySelector(`[data-k="${k}"]`) as T;

/** Бесплатные варианты деталей кузова: [слот, значение, подпись]. */
const FREE_PARTS: [string, string, string][] = [
  ['spoiler', 'none', 'free.spoiler.none'],
  ['spoiler', 'lip', 'free.spoiler.lip'],
  ['spoiler', 'wing', 'free.spoiler.wing'],
  ['rims', 'five', 'free.rims.five'],
  ['livery', 'none', 'free.vinyl.none'],
  ['look', 'none', 'free.look.none'],
  ['smoke', 'none', 'free.smoke.none'],
  ['kit', 'stock', 'free.kit.stock'],
];

export const PAINTS = [
  '#e8eef7',
  '#d8262f',
  '#2f7de1',
  '#f2b31b',
  '#22c06e',
  '#9b40e0',
  '#ff7a1a',
  '#15171c',
];
export const NEONS = ['off', '#29e0ff', '#ff2bd6', '#8cff3a', '#ffb02b'];

/** Вход / регистрация (email). Telegram-вход работает через API, виджет подключается при наличии бота. */
export function showProfile(root: HTMLElement, done: () => void): void {
  if (account.token) {
    const s = screen(
      root,
      `<p class="big" style="font:900 italic 32px var(--font);margin:0">${escapeHtml(account.name ?? '')}</p>
      <p class="sub" data-k="wallet">${t('ui.loading')}</p>
      <div class="btnrow"><button class="btn" data-k="out">${t('acc.logout')}</button><button class="btn" data-k="back">${t('ui.back')}</button></div>`,
    );
    void wallet()
      .then(
        (w) =>
          (q(s.el, 'wallet').textContent = t('acc.wallet', {
            cr: w.credits.toLocaleString(locale()),
            tok: w.tokens,
          })),
      )
      .catch((e) => (q(s.el, 'wallet').textContent = errText(e)));
    q(s.el, 'out').onclick = () => {
      logout();
      s.close();
      done();
    };
    q(s.el, 'back').onclick = () => {
      s.close();
      done();
    };
    return;
  }
  const s = screen(
    root,
    `<p class="big" style="font:900 italic 32px var(--font);margin:0">${t('acc.title')}</p>
    <p class="sub">${t('acc.sub')}</p>
    <h2>${t('acc.email')}</h2><input type="text" data-k="email" autocomplete="email" />
    <h2>${t('acc.pass')}</h2><input type="text" data-k="pass" style="-webkit-text-security:disc" autocomplete="current-password" />
    <h2>${t('acc.name')}</h2><input type="text" data-k="name" maxlength="32" />
    <p class="sub" data-k="err" style="color:#ff7088"></p>
    <div class="btnrow"><button class="btn" data-k="login">${t('acc.login')}</button><button class="btn" data-k="reg">${t('acc.register')}</button><button class="btn" data-k="back">${t('ui.back')}</button></div>`,
  );
  const val = (k: string) => q<HTMLInputElement>(s.el, k).value.trim();
  const run = async (f: () => Promise<void>) => {
    q(s.el, 'err').textContent = '';
    try {
      await f();
      s.close();
      done();
    } catch (e) {
      q(s.el, 'err').textContent = errText(e);
    }
  };
  q(s.el, 'login').onclick = () => run(() => login(val('email'), val('pass')));
  q(s.el, 'reg').onclick = () =>
    run(() => register(val('email'), val('pass'), val('name') || t('menu.defaultName')));
  q(s.el, 'back').onclick = () => {
    s.close();
    done();
  };
}

/** Гараж: машины, выбор для заездов, тюнинг по категориям, покраска и неон, покупка машин. */
export function showGarage(root: HTMLElement, done: () => void): void {
  if (!account.token) return showProfile(root, done);
  const s = screen(root, `<p class="sub">${t('garage.loading')}</p>`);
  const panel = s.el.querySelector('.panel') as HTMLElement;
  let selected: string | null = account.ownedCarId;

  const render = async () => {
    let cars: OwnedCar[];
    let money = 0;
    let shop: Awaited<ReturnType<typeof catalog>>;
    type Owned = { id: string; slot: string; value: string; name: string; owned: boolean };
    let owned: Owned[] = [];
    try {
      [cars, money, shop, owned] = await Promise.all([
        garageList(),
        wallet().then((w) => w.credits),
        catalog(),
        api<Owned[]>('/api/shop/cosmetics').catch(() => [] as Owned[]),
      ]);
      owned = owned.filter((o) => o.owned);
    } catch (e) {
      panel.innerHTML = `<p class="sub">${escapeHtml(errText(e))}</p><div class="btnrow"><button class="btn" data-k="back">${t('ui.back')}</button></div>`;
      q(panel, 'back').onclick = () => {
        s.close();
        done();
      };
      return;
    }
    const cur = cars.find((c) => c.id === selected) ?? cars[0]!;
    selected = cur.id;
    account.ownedCarId = cur.id;
    saveAccount();
    const base = CARS[cur.carId]!;
    const rows = PART_CATEGORIES.map((cat) => {
      const lv = cur.parts[cat] ?? 0;
      const next = lv + 1;
      const price = TUNING.categories[cat].price[next];
      const piAfter =
        next <= 4 ? computePI(applyTuning(base, { ...cur.parts, [cat]: next })) : cur.pi;
      return `<tr><td>${t(`part.${cat}`)}</td><td>${'■'.repeat(lv)}${'□'.repeat(4 - lv)}</td>
        <td>${next <= 4 ? `<button class="btn" data-buy="${cat}" ${price! > money ? 'disabled' : ''}>${t('garage.level', { n: next, price: price!.toLocaleString(locale()), pi: piAfter })}</button>` : t('garage.max')}</td></tr>`;
    }).join('');
    const vis = resolveVisual(cur.visual);
    const paint = vis.paint ?? '#e8eef7';
    const neon = vis.neon ?? '#29e0ff';
    // Кузовные киты — только у машин с glTF-моделью и китами этой модели
    const fits = (slot: string, value: string) =>
      slot !== 'kit' ||
      (!!base.kits?.length && (!value || value === 'stock' || base.kits.includes(value)));
    const mine = owned.filter((o) => fits(o.slot, o.value));
    panel.innerHTML = `<div class="results">
      <p class="big" style="font:900 italic 30px var(--font);margin:0">${t('menu.garage')}</p>
      <p class="sub">${t('garage.credits', { n: `<b>${money.toLocaleString(locale())}</b>` })}</p>
      <div class="grid2">${cars
        .map(
          (
            c,
          ) => `<button class="btn ${c.id === cur.id ? 'sel' : ''}" data-car="${c.id}">${escapeHtml(CARS[c.carId]?.name ?? c.carId)}
          <small>${t('garage.pi', { pi: c.pi, cls: c.carClass })}</small></button>`,
        )
        .join('')}</div>
      <h2>${t('garage.tuning', { car: escapeHtml(base.name), pi: cur.pi, cls: cur.carClass })}</h2>
      <table>${rows}</table>
      <h2>${t('garage.paint')}</h2><div class="row">${PAINTS.map((c) => `<button class="swatch ${c === paint ? 'sel' : ''}" data-paint="${c}" style="background:${c}"></button>`).join('')}</div>
      <h2>${t('garage.neon')}</h2><div class="row">${NEONS.map((c) => `<button class="swatch ${c === neon ? 'sel' : ''}" data-neon="${c}" style="background:${c === 'off' ? '#222' : c}">${c === 'off' ? '×' : ''}</button>`).join('')}</div>
      <h2>${t('garage.body')}</h2><div class="row">${FREE_PARTS.filter(([slot]) => fits(slot, ''))
        .map(
          ([slot, value, name]) =>
            `<button class="btn ${(vis[slot] ?? (slot === 'kit' ? 'stock' : 'none')) === value ? 'sel' : ''}" data-slot="${slot}" data-val="${value}">${t(name)}</button>`,
        )
        .join('')}</div>
      ${
        mine.length
          ? `<h2>${t('garage.bought')}</h2><div class="row">${mine
              .map(
                (o) =>
                  `<button class="btn ${(o.slot === 'look' ? cur.visual.look : vis[o.slot]) === o.value ? 'sel' : ''}" data-slot="${o.slot}" data-val="${o.value}">${escapeHtml(has(`item.${o.id}`) ? t(`item.${o.id}`) : o.name)}</button>`,
              )
              .join('')}</div>`
          : `<p class="hint">${t('garage.shopHint')}</p>`
      }
      <h2>${t('garage.dealer')}</h2><div class="grid2">${
        shop
          .filter((c) => !cars.some((o) => o.carId === c.id))
          .map(
            (
              c,
            ) => `<button class="btn" data-shop="${c.id}" ${c.price > money ? 'disabled' : ''}>${escapeHtml(c.name)}
          <small>${t('garage.dealerCar', { era: c.era, pi: c.pi, price: c.price.toLocaleString(locale()) })}</small></button>`,
          )
          .join('') || `<p class="sub">${t('garage.allOwned')}</p>`
      }</div>
      <p class="sub" data-k="err" style="color:#ff7088"></p>
      <div class="btnrow"><button class="btn" data-k="back">${t('ui.done')}</button></div></div>`;
    const act = async (f: () => Promise<unknown>) => {
      try {
        await f();
        await render();
      } catch (e) {
        q(panel, 'err').textContent = errText(e);
      }
    };
    panel.querySelectorAll<HTMLElement>('[data-car]').forEach((b) => {
      b.onclick = () => {
        selected = b.dataset.car!;
        void render();
      };
    });
    panel.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => {
      b.onclick = () => {
        const cat = b.dataset.buy as PartCategory;
        void act(() =>
          api(`/api/garage/cars/${cur.id}/parts`, {
            body: { category: cat, level: (cur.parts[cat] ?? 0) + 1 },
            key: newKey(),
          }),
        );
      };
    });
    // Любая отдельная деталь снимает образ: иначе образ перекрыл бы её (resolveVisual)
    const visual = (v: Record<string, string>) =>
      act(() =>
        api(`/api/garage/cars/${cur.id}/visual`, {
          method: 'PUT',
          body:
            'look' in v || !cur.visual.look || cur.visual.look === 'none'
              ? v
              : { ...v, look: 'none' },
        }),
      );
    panel
      .querySelectorAll<HTMLElement>('[data-paint]')
      .forEach((b) => (b.onclick = () => void visual({ paint: b.dataset.paint! })));
    panel
      .querySelectorAll<HTMLElement>('[data-neon]')
      .forEach((b) => (b.onclick = () => void visual({ neon: b.dataset.neon! })));
    panel
      .querySelectorAll<HTMLElement>('[data-slot]')
      .forEach((b) => (b.onclick = () => void visual({ [b.dataset.slot!]: b.dataset.val! })));
    panel.querySelectorAll<HTMLElement>('[data-shop]').forEach((b) => {
      b.onclick = () =>
        void act(() => api('/api/garage/cars', { body: { carId: b.dataset.shop }, key: newKey() }));
    });
    q(panel, 'back').onclick = () => {
      s.close();
      done();
    };
  };
  void render();
}

/** Таблицы рекордов (топ-100) по трассе, погоде и классу. */
export function showRecords(root: HTMLElement, done: () => void): void {
  const tracks = Object.values(TRACKS).filter((t) => t.type !== 'drift');
  let track = tracks[0]!.id;
  let weather: Weather = 'dry';
  let cls = 'D';
  const s = screen(root, '');
  const panel = s.el.querySelector('.panel') as HTMLElement;
  const render = async () => {
    panel.innerHTML = `<div class="results"><p class="big" style="font:900 italic 30px var(--font);margin:0">${t('menu.records')}</p>
      <div class="row">${tracks.map((tr) => `<button class="btn ${tr.id === track ? 'sel' : ''}" data-t="${tr.id}">${t(`track.${tr.id}`)}</button>`).join('')}</div>
      <div class="row" style="margin-top:8px">${(['dry', 'wet', 'snow'] as Weather[]).map((w) => `<button class="btn ${w === weather ? 'sel' : ''}" data-w="${w}">${t(`weather.${w}`)}</button>`).join('')}</div>
      <div class="row" style="margin-top:8px">${['D', 'C', 'B', 'A', 'S'].map((c) => `<button class="btn ${c === cls ? 'sel' : ''}" data-c="${c}">${c}</button>`).join('')}</div>
      <div data-k="table"><p class="sub">${t('ui.loading')}</p></div>
      <p class="hint">${t('rec.hint')}</p>
      <div class="btnrow"><button class="btn" data-k="back">${t('ui.back')}</button></div></div>`;
    panel
      .querySelectorAll<HTMLElement>('[data-t]')
      .forEach((b) => (b.onclick = () => ((track = b.dataset.t!), void render())));
    panel
      .querySelectorAll<HTMLElement>('[data-w]')
      .forEach((b) => (b.onclick = () => ((weather = b.dataset.w as Weather), void render())));
    panel
      .querySelectorAll<HTMLElement>('[data-c]')
      .forEach((b) => (b.onclick = () => ((cls = b.dataset.c!), void render())));
    q(panel, 'back').onclick = () => {
      s.close();
      done();
    };
    try {
      const rows = await api<
        { rank: number; userId: string; name: string; carId: string; lapSteps: number }[]
      >(`/api/records/${track}?weather=${weather}&class=${cls}`, { auth: false });
      q(panel, 'table').innerHTML = rows.length
        ? `<table><tr><th>#</th><th>${t('res.racer')}</th><th>${t('menu.car')}</th><th>${t('rec.lap')}</th></tr>${rows
            .map(
              (
                r,
              ) => `<tr class="${r.userId === account.userId ? 'me' : ''}"><td>${r.rank}</td><td>${escapeHtml(r.name)}</td>
              <td>${escapeHtml(CARS[r.carId]?.name ?? r.carId)}</td><td>${formatTime(r.lapSteps / 60)}</td></tr>`,
            )
            .join('')}</table>`
        : `<p class="sub">${t('rec.empty')}</p>`;
    } catch (e) {
      q(panel, 'table').innerHTML = `<p class="sub">${escapeHtml(errText(e))}</p>`;
    }
  };
  void render();
}

/** Рейтинг Эло сезона по классам. */
export function showRatings(root: HTMLElement, done: () => void): void {
  let cls = 'D';
  const s = screen(root, '');
  const panel = s.el.querySelector('.panel') as HTMLElement;
  const render = async () => {
    panel.innerHTML = `<div class="results"><p class="big" style="font:900 italic 30px var(--font);margin:0">${t('rat.title')}</p>
      <div class="row">${['D', 'C', 'B', 'A', 'S'].map((c) => `<button class="btn ${c === cls ? 'sel' : ''}" data-c="${c}">${t('rat.class', { cls: c })}</button>`).join('')}</div>
      <div data-k="table"><p class="sub">${t('ui.loading')}</p></div>
      <p class="hint">${t('rat.hint')}</p>
      <div class="btnrow"><button class="btn" data-k="back">${t('ui.back')}</button></div></div>`;
    panel
      .querySelectorAll<HTMLElement>('[data-c]')
      .forEach((b) => (b.onclick = () => ((cls = b.dataset.c!), void render())));
    q(panel, 'back').onclick = () => {
      s.close();
      done();
    };
    try {
      const rows = await api<
        { rank: number; userId: string; name: string; rating: number; games: number }[]
      >(`/api/ratings/${cls}`, {
        auth: false,
      });
      q(panel, 'table').innerHTML = rows.length
        ? `<table><tr><th>#</th><th>${t('res.racer')}</th><th>${t('rat.rating')}</th><th>${t('rat.games')}</th></tr>${rows
            .map(
              (r) =>
                `<tr class="${r.userId === account.userId ? 'me' : ''}"><td>${r.rank}</td><td>${escapeHtml(r.name)}</td><td>${r.rating}</td><td>${r.games}</td></tr>`,
            )
            .join('')}</table>`
        : `<p class="sub">${t('rat.empty')}</p>`;
    } catch (e) {
      q(panel, 'table').innerHTML = `<p class="sub">${escapeHtml(errText(e))}</p>`;
    }
  };
  void render();
}

const SEEN_KEY = 'sr:dispatcher-seen';
export function dispatcherSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

/** Диалог с «Диспетчером». Гость проходит локально; вошедший — с сервером (награда в конце). */
/** Реплика диспетчера на языке игрока; без перевода — из сценария. */
const storyText = (k: string, fallback: string) => (has(`story.${k}`) ? t(`story.${k}`) : fallback);

export function showDispatcher(root: HTMLElement, done: () => void): void {
  const s = screen(root, '');
  s.el.classList.add('dispatcher');
  const panel = s.el.querySelector('.panel') as HTMLElement;
  let node = DISPATCHER.start;
  const finish = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* без хранилища */
    }
    s.close();
    done();
  };
  const render = () => {
    const n = DISPATCHER.nodes[node];
    if (!n || n.end) return finish();
    panel.innerHTML = `<div class="radio"><span class="dot"></span>${t('story.speaker')} · ${t('story.channel')}</div>
      <p class="line" data-k="text"></p>
      <div class="btnrow" style="flex-direction:column">${n.choices.map((c, i) => `<button class="btn" data-i="${i}">${escapeHtml(storyText(`${node}.c${i}`, c.text))}</button>`).join('')}</div>
      <p class="hint">${account.token ? t('story.bonus', { n: DISPATCHER.reward.toLocaleString(locale()) }) : t('story.login')}</p>`;
    // Эффект «печатает по рации»
    const el = q(panel, 'text');
    const text = storyText(node, n.text);
    let i = 0;
    const tick = setInterval(() => {
      i += 2;
      el.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(tick);
    }, 16);
    panel.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => {
      b.onclick = async () => {
        clearInterval(tick);
        const choice = Number(b.dataset.i);
        const next = storyNext(DISPATCHER, node, choice);
        if (!next) return;
        if (account.token) {
          try {
            await api('/api/onboarding', { body: { node, choice } });
          } catch {
            /* офлайн — продолжаем локально */
          }
        }
        node = next;
        render();
      };
    });
  };
  if (account.token) {
    void api<{ node: string; completed: boolean }>('/api/onboarding')
      .then((st) => {
        if (st.completed) return finish();
        node = st.node;
        render();
      })
      .catch(() => render());
  } else render();
}

/** Подсказка класса и PI для текущего конфига (используется в меню). */
export const piInfo = (carId: string, parts: Record<string, number>) => {
  const pi = computePI(applyTuning(CARS[carId]!, parts));
  return { pi, cls: piClass(pi) };
};
