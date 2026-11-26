import {
  CARS,
  DISPATCHER,
  PART_CATEGORIES,
  TUNING,
  TRACKS,
  WEATHER_NAMES,
  applyTuning,
  computePI,
  formatTime,
  piClass,
  storyNext,
  type PartCategory,
  type Weather,
} from '@sr/shared';
import { escapeHtml } from '../ui/menu';
import { account, logout, saveAccount } from './account';
import {
  ApiError,
  api,
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
const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Что-то пошло не так');

/** Бесплатные варианты деталей кузова: [слот, значение, подпись]. */
const FREE_PARTS: [string, string, string][] = [
  ['spoiler', 'none', 'Без спойлера'],
  ['spoiler', 'lip', 'Губа'],
  ['spoiler', 'wing', 'Антикрыло'],
  ['rims', 'five', 'Диски: 5 спиц'],
  ['vinyl', 'none', 'Без винила'],
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
      <p class="sub" data-k="wallet">Загрузка…</p>
      <div class="btnrow"><button class="btn" data-k="out">Выйти из аккаунта</button><button class="btn" data-k="back">Назад</button></div>`,
    );
    void wallet()
      .then(
        (w) =>
          (q(s.el, 'wallet').textContent =
            `Кредиты: ${w.credits.toLocaleString('ru-RU')} · жетоны: ${w.tokens}`),
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
    `<p class="big" style="font:900 italic 32px var(--font);margin:0">Аккаунт</p>
    <p class="sub">Нужен для гаража, тюнинга, наград, рекордов и рейтинга. Без аккаунта можно просто кататься.</p>
    <h2>Email</h2><input type="text" data-k="email" autocomplete="email" />
    <h2>Пароль (от 8 символов)</h2><input type="text" data-k="pass" style="-webkit-text-security:disc" autocomplete="current-password" />
    <h2>Имя в игре (для регистрации)</h2><input type="text" data-k="name" maxlength="32" />
    <p class="sub" data-k="err" style="color:#ff7088"></p>
    <div class="btnrow"><button class="btn" data-k="login">Войти</button><button class="btn" data-k="reg">Зарегистрироваться</button><button class="btn" data-k="back">Назад</button></div>`,
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
    run(() => register(val('email'), val('pass'), val('name') || 'Гонщик'));
  q(s.el, 'back').onclick = () => {
    s.close();
    done();
  };
}

/** Гараж: машины, выбор для заездов, тюнинг по категориям, покраска и неон, покупка машин. */
export function showGarage(root: HTMLElement, done: () => void): void {
  if (!account.token) return showProfile(root, done);
  const s = screen(root, `<p class="sub">Загрузка гаража…</p>`);
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
      panel.innerHTML = `<p class="sub">${escapeHtml(errText(e))}</p><div class="btnrow"><button class="btn" data-k="back">Назад</button></div>`;
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
      return `<tr><td>${TUNING.categories[cat].name}</td><td>${'■'.repeat(lv)}${'□'.repeat(4 - lv)}</td>
        <td>${next <= 4 ? `<button class="btn" data-buy="${cat}" ${price! > money ? 'disabled' : ''}>Ур. ${next} · ${price!.toLocaleString('ru-RU')} · PI ${piAfter}</button>` : 'максимум'}</td></tr>`;
    }).join('');
    const paint = cur.visual.paint ?? '#e8eef7';
    const neon = cur.visual.neon ?? '#29e0ff';
    panel.innerHTML = `<div class="results">
      <p class="big" style="font:900 italic 30px var(--font);margin:0">Гараж</p>
      <p class="sub">Кредиты: <b>${money.toLocaleString('ru-RU')}</b></p>
      <div class="grid2">${cars
        .map(
          (
            c,
          ) => `<button class="btn ${c.id === cur.id ? 'sel' : ''}" data-car="${c.id}">${escapeHtml(CARS[c.carId]?.name ?? c.carId)}
          <small>PI ${c.pi} · класс ${c.carClass}</small></button>`,
        )
        .join('')}</div>
      <h2>Тюнинг — ${escapeHtml(base.name)} (PI ${cur.pi}, класс ${cur.carClass})</h2>
      <table>${rows}</table>
      <h2>Цвет</h2><div class="row">${PAINTS.map((c) => `<button class="swatch ${c === paint ? 'sel' : ''}" data-paint="${c}" style="background:${c}"></button>`).join('')}</div>
      <h2>Неон</h2><div class="row">${NEONS.map((c) => `<button class="swatch ${c === neon ? 'sel' : ''}" data-neon="${c}" style="background:${c === 'off' ? '#222' : c}">${c === 'off' ? '×' : ''}</button>`).join('')}</div>
      <h2>Кузов (бесплатно)</h2><div class="row">${FREE_PARTS.map(
        ([slot, value, name]) =>
          `<button class="btn ${(cur.visual[slot] ?? '') === value ? 'sel' : ''}" data-slot="${slot}" data-val="${value}">${name}</button>`,
      ).join('')}</div>
      ${
        owned.length
          ? `<h2>Купленное в магазине</h2><div class="row">${owned
              .map(
                (o) =>
                  `<button class="btn ${cur.visual[o.slot] === o.value ? 'sel' : ''}" data-slot="${o.slot}" data-val="${o.value}">${escapeHtml(o.name)}</button>`,
              )
              .join('')}</div>`
          : '<p class="hint">Премиум-краски, неон, винилы и диски — в «Магазине».</p>'
      }
      <h2>Автосалон</h2><div class="grid2">${
        shop
          .filter((c) => !cars.some((o) => o.carId === c.id))
          .map(
            (
              c,
            ) => `<button class="btn" data-shop="${c.id}" ${c.price > money ? 'disabled' : ''}>${escapeHtml(c.name)}
          <small>эпоха ${c.era} · PI ${c.pi} · ${c.price.toLocaleString('ru-RU')} кр.</small></button>`,
          )
          .join('') || '<p class="sub">Все машины уже в гараже</p>'
      }</div>
      <p class="sub" data-k="err" style="color:#ff7088"></p>
      <div class="btnrow"><button class="btn" data-k="back">Готово</button></div></div>`;
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
    const visual = (v: Record<string, string>) =>
      act(() => api(`/api/garage/cars/${cur.id}/visual`, { method: 'PUT', body: v }));
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
    panel.innerHTML = `<div class="results"><p class="big" style="font:900 italic 30px var(--font);margin:0">Рекорды</p>
      <div class="row">${tracks.map((t) => `<button class="btn ${t.id === track ? 'sel' : ''}" data-t="${t.id}">${escapeHtml(t.name)}</button>`).join('')}</div>
      <div class="row" style="margin-top:8px">${(['dry', 'wet', 'snow'] as Weather[]).map((w) => `<button class="btn ${w === weather ? 'sel' : ''}" data-w="${w}">${WEATHER_NAMES[w]}</button>`).join('')}</div>
      <div class="row" style="margin-top:8px">${['D', 'C', 'B', 'A', 'S'].map((c) => `<button class="btn ${c === cls ? 'sel' : ''}" data-c="${c}">${c}</button>`).join('')}</div>
      <div data-k="table"><p class="sub">Загрузка…</p></div>
      <p class="hint">В топ-100 попадают только заезды, которые сервер повторил по записи ввода и получил то же время.</p>
      <div class="btnrow"><button class="btn" data-k="back">Назад</button></div></div>`;
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
        ? `<table><tr><th>#</th><th>Гонщик</th><th>Машина</th><th>Круг</th></tr>${rows
            .map(
              (
                r,
              ) => `<tr class="${r.userId === account.userId ? 'me' : ''}"><td>${r.rank}</td><td>${escapeHtml(r.name)}</td>
              <td>${escapeHtml(CARS[r.carId]?.name ?? r.carId)}</td><td>${formatTime(r.lapSteps / 60)}</td></tr>`,
            )
            .join('')}</table>`
        : '<p class="sub">Пока пусто — будьте первым.</p>';
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
    panel.innerHTML = `<div class="results"><p class="big" style="font:900 italic 30px var(--font);margin:0">Рейтинг сезона</p>
      <div class="row">${['D', 'C', 'B', 'A', 'S'].map((c) => `<button class="btn ${c === cls ? 'sel' : ''}" data-c="${c}">Класс ${c}</button>`).join('')}</div>
      <div data-k="table"><p class="sub">Загрузка…</p></div>
      <p class="hint">Считаются открытые онлайн-гонки от двух игроков с аккаунтом. Рейтинг — в классе вашей машины.</p>
      <div class="btnrow"><button class="btn" data-k="back">Назад</button></div></div>`;
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
        ? `<table><tr><th>#</th><th>Гонщик</th><th>Рейтинг</th><th>Гонок</th></tr>${rows
            .map(
              (r) =>
                `<tr class="${r.userId === account.userId ? 'me' : ''}"><td>${r.rank}</td><td>${escapeHtml(r.name)}</td><td>${r.rating}</td><td>${r.games}</td></tr>`,
            )
            .join('')}</table>`
        : '<p class="sub">В этом классе ещё никто не гонялся.</p>';
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
    panel.innerHTML = `<div class="radio"><span class="dot"></span>${escapeHtml(DISPATCHER.speaker)} · канал 7</div>
      <p class="line" data-k="text"></p>
      <div class="btnrow" style="flex-direction:column">${n.choices.map((c, i) => `<button class="btn" data-i="${i}">${escapeHtml(c.text)}</button>`).join('')}</div>
      <p class="hint">${account.token ? `За разговор — бонус ${DISPATCHER.reward.toLocaleString('ru-RU')} кредитов.` : 'Войдите в аккаунт, чтобы получить стартовый бонус.'}</p>`;
    // Эффект «печатает по рации»
    const el = q(panel, 'text');
    let i = 0;
    const tick = setInterval(() => {
      i += 2;
      el.textContent = n.text.slice(0, i);
      if (i >= n.text.length) clearInterval(tick);
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
