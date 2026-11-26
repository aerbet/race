import {
  CARS,
  RARITIES,
  SHOP_TABS,
  getLang,
  has,
  resolveVisual,
  t,
  tabOfSlot,
  tn,
  type Rarity,
  type ShopTab,
} from '@sr/shared';
import { CarPreview } from './car-preview';
import { escapeHtml } from '../ui/menu';
import { account } from './account';
import { activeCar, api, errText, newKey, wallet, type OwnedCar } from './api';

interface Price {
  amount: string;
  currency: string;
}
interface Offer {
  id: string;
  name: string;
  tokens: number;
  badge?: string;
  prices: Record<string, Price>;
}
interface Item {
  id: string;
  slot: string;
  value: string;
  name: string;
  price: number;
  owned: boolean;
  rarity: Rarity;
  inRotation: boolean;
}
interface Showcase {
  endsAt: string;
  items: Item[];
}

/** Кит подходит машине, только если у её модели он есть. */
const carFits = (carId: string, kit: string) =>
  kit === 'stock' || !!CARS[carId]?.kits?.includes(kit);
interface PaymentView {
  id: string;
  status: string;
  payUrl: string;
  tokens: number;
}

/** Telegram Mini App: счёт Stars открывается внутри Telegram без перехода. */
interface TgWebApp {
  openInvoice?: (url: string, cb?: (status: string) => void) => void;
}
const tgApp = (): TgWebApp | undefined =>
  (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

const provName = (p: string) => (has(`pay.${p}`) ? t(`pay.${p}`) : p);
const itemName = (i: Item) => (has(`item.${i.id}`) ? t(`item.${i.id}`) : i.name);

/** Порядок способов: в Telegram — Stars, русский язык — рубли (СБП), остальные — доллары. */
export function preferredProviders(lang: string, inTelegram: boolean): string[] {
  const base = lang === 'ru' ? ['sbp', 'cryptobot', 'stars'] : ['cryptobot', 'stars', 'sbp'];
  return inTelegram ? ['stars', ...base.filter((p) => p !== 'stars')] : base;
}

export function formatPrice(p: Price, lang: string): string {
  const n = Number(p.amount);
  if (p.currency === 'XTR') return `⭐ ${n}`;
  const loc = lang === 'ru' ? 'ru-RU' : 'en-US';
  return new Intl.NumberFormat(loc, {
    style: 'currency',
    currency: p.currency,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);
}

/** Способы оплаты пакета в порядке для этого игрока. */
export function methodsFor(o: Offer, lang: string, inTelegram: boolean): string[] {
  const order = preferredProviders(lang, inTelegram);
  return Object.keys(o.prices).sort(
    (a, b) => ((order.indexOf(a) + 99) % 99) - ((order.indexOf(b) + 99) % 99),
  );
}

/**
 * Ателье: пакеты жетонов и косметика за жетоны. У пакета — цена в валюте игрока и одна кнопка
 * «Купить»; способ оплаты (СБП, крипта, Stars) — на следующем шаге. Экран опрашивает статус,
 * пока провайдер не подтвердит оплату.
 */
export function showShop(root: HTMLElement, done: () => void, returnedPayment?: string): void {
  const el = document.createElement('div');
  el.className = 'screen meta';
  el.innerHTML = `<div class="menu panel results" data-k="panel"></div>`;
  root.appendChild(el);
  const panel = el.querySelector('[data-k="panel"]') as HTMLElement;
  const lang = getLang();
  const inTg = !!tgApp()?.openInvoice;
  let polling = 0;
  let clock = 0;
  let preview: CarPreview | null = null;
  let tab: ShopTab = 'looks';
  /** Сообщение переживает перерисовку экрана (после оплаты список обновляется). */
  let notice = '';
  const stopPreview = () => {
    clearInterval(clock);
    preview?.dispose();
    preview = null;
  };
  const close = () => {
    clearInterval(polling);
    stopPreview();
    el.remove();
    done();
  };
  const $ = <T extends HTMLElement = HTMLElement>(k: string) =>
    panel.querySelector(`[data-k="${k}"]`) as T;

  const waitFor = (id: string, msg: HTMLElement) => {
    clearInterval(polling);
    const started = Date.now();
    msg.textContent = t('shop.waiting');
    polling = window.setInterval(async () => {
      try {
        const p = await api<PaymentView>(`/api/payments/${id}`);
        if (p.status === 'paid') {
          clearInterval(polling);
          notice = tn('shop.paid', p.tokens);
          void packs();
        } else if (p.status === 'failed' || p.status === 'expired') {
          clearInterval(polling);
          msg.textContent = t(p.status === 'failed' ? 'shop.payFailed' : 'shop.expired');
        } else if (Date.now() - started > 15 * 60_000) {
          clearInterval(polling);
          msg.textContent = t('shop.slow');
        }
      } catch {
        /* сеть — попробуем на следующем тике */
      }
    }, 3000);
  };

  const pay = async (o: Offer, provider: string, msg: HTMLElement) => {
    const tg = provider === 'stars' ? tgApp() : undefined;
    // Окно открываем сразу по клику (иначе браузер заблокирует всплывающее)
    const win = tg?.openInvoice ? null : window.open('', '_blank');
    try {
      const p = await api<PaymentView>('/api/payments', {
        body: { productId: o.id, provider },
        key: newKey(),
      });
      if (tg?.openInvoice) tg.openInvoice(p.payUrl);
      else if (win) win.location.href = p.payUrl;
      else location.href = p.payUrl;
      waitFor(p.id, msg);
    } catch (e) {
      win?.close();
      msg.textContent = errText(e);
    }
  };

  /** Шаг 2: способ оплаты выбранного пакета. */
  const choose = (o: Offer) => {
    stopPreview();
    panel.innerHTML = `<p class="big" style="font:900 italic 30px var(--font);margin:0">${tn('shop.pack', o.tokens)}</p>
      <p class="sub">${t('shop.how')}</p>
      <div class="grid2">${methodsFor(o, lang, inTg)
        .map(
          (prov) =>
            `<button class="btn" data-prov="${prov}">${provName(prov)}<small>${formatPrice(o.prices[prov]!, lang)}</small></button>`,
        )
        .join('')}</div>
      <p class="sub" data-k="msg"></p>
      <div class="btnrow"><button class="btn" data-k="back">${t('ui.back')}</button></div>`;
    const msg = $('msg');
    $('back').onclick = () => {
      clearInterval(polling);
      void packs();
    };
    panel.querySelectorAll<HTMLElement>('[data-prov]').forEach((b) => {
      b.onclick = () => void pay(o, b.dataset.prov!, msg);
    });
  };

  /** Пакеты жетонов: у каждого — цена в валюте игрока и «Купить». */
  const packs = async (): Promise<void> => {
    stopPreview();
    panel.innerHTML = `<p class="sub">${t('ui.loading')}</p>`;
    let offers: Offer[];
    try {
      offers = await api<Offer[]>('/api/shop/products', { auth: false });
    } catch (e) {
      return fail(e);
    }
    const buyable = offers.filter((o) => Object.keys(o.prices).length > 0);
    panel.innerHTML = `<p class="big" style="font:900 italic 30px var(--font);margin:0">${t('shop.packs')}</p>
      ${
        buyable.length
          ? `<div class="grid2">${buyable
              .map((o) => {
                const main = methodsFor(o, lang, inTg)[0]!;
                return `<button class="btn offer" data-pack="${o.id}"><b>${tn('shop.pack', o.tokens)}</b>${
                  o.badge ? ` <span class="badge">${escapeHtml(o.badge)}</span>` : ''
                }<small>${t('shop.buy')} · ${formatPrice(o.prices[main]!, lang)}</small></button>`;
              })
              .join('')}</div>`
          : `<p class="sub">${t('shop.noPay')}</p>`
      }
      <p class="sub" data-k="msg"></p>
      <div class="btnrow"><button class="btn" data-k="back">${t('ui.back')}</button></div>`;
    const msg = $('msg');
    msg.textContent = notice;
    $('back').onclick = () => {
      clearInterval(polling);
      void render();
    };
    panel.querySelectorAll<HTMLElement>('[data-pack]').forEach((b) => {
      b.onclick = () => choose(buyable.find((o) => o.id === b.dataset.pack)!);
    });
    if (returnedPayment) {
      const id = returnedPayment;
      returnedPayment = undefined;
      waitFor(id, msg);
    }
  };

  const fail = (e: unknown) => {
    stopPreview();
    panel.innerHTML = `<p class="sub">${escapeHtml(errText(e))}</p><div class="btnrow"><button class="btn" data-k="back">${t('ui.back')}</button></div>`;
    $('back').onclick = close;
  };

  /** Витрина (9.4): примерка на своей машине, вкладки, редкость, таймер ротации. */
  const render = async (): Promise<void> => {
    if (!account.token) {
      stopPreview();
      panel.innerHTML = `<p class="big" style="font:900 italic 30px var(--font);margin:0">${t('menu.shop')}</p>
        <p class="sub">${t('shop.login')}</p><div class="btnrow"><button class="btn" data-k="back">${t('ui.back')}</button></div>`;
      $('back').onclick = close;
      return;
    }
    if (returnedPayment) return packs();
    let show: Showcase, tokens: number, car: OwnedCar | null;
    try {
      [show, tokens, car] = await Promise.all([
        api<Showcase>('/api/shop/showcase'),
        wallet().then((w) => w.tokens),
        activeCar(),
      ]);
    } catch (e) {
      return fail(e);
    }
    const items = show.items.filter((i) => i.slot !== 'kit' || !car || carFits(car.carId, i.value));
    const ends = new Date(show.endsAt).getTime();
    stopPreview();
    panel.innerHTML = `<div class="shop-head"><p class="big" style="font:900 italic 30px var(--font);margin:0">${t('menu.shop')}</p>
        <div class="row"><span class="sub">${t('shop.tokens', { n: `<b>${tokens}</b>` })}</span><button class="btn" data-k="topup">${t('shop.topUp')}</button></div></div>
      <p class="sub" data-k="timer"></p>
      <div class="preview-box" data-k="preview">${car ? '' : `<p class="sub">${t('shop.noCar')}</p>`}</div>
      <div class="tryon"><span data-k="tryName"></span><button class="btn primary" data-k="act" hidden></button></div>
      <div class="row shop-tabs">${(Object.keys(SHOP_TABS) as ShopTab[])
        .map(
          (id) =>
            `<button class="btn ${tab === id ? 'sel' : ''}" data-tab="${id}">${t(`tab.${id}`)}</button>`,
        )
        .join('')}</div>
      <div class="grid3" data-k="grid"></div>
      <p class="sub" data-k="msg"></p>
      <div class="btnrow"><button class="btn" data-k="back">${t('ui.done')}</button></div>`;
    const msg = $('msg');
    msg.textContent = notice;
    notice = '';
    $('back').onclick = close;
    $('topup').onclick = () => void packs();
    const timer = () => {
      const left = Math.max(0, ends - Date.now());
      const h = Math.floor(left / 3_600_000);
      const m = Math.floor((left % 3_600_000) / 60_000);
      const el = panel.querySelector('[data-k="timer"]');
      if (el) el.textContent = t('shop.rotation', { time: t('time.hm', { h, m }) });
      if (left === 0) void render();
    };
    timer();
    clock = window.setInterval(timer, 30_000);
    if (car) {
      preview = new CarPreview($('preview'));
      preview.show(car.carId, car.visual, car.parts);
    }
    let picked: Item | null = null;
    const act = $<HTMLButtonElement>('act');
    const worn = (i: Item) =>
      !!car &&
      (i.slot === 'look'
        ? car.visual.look === i.value
        : resolveVisual(car.visual)[i.slot] === i.value &&
          (!car.visual.look || car.visual.look === 'none'));
    const tryOn = (i: Item) => {
      picked = i;
      $('tryName').innerHTML =
        `${t('shop.tryOn')}: <b>${escapeHtml(itemName(i))}</b> <span class="rarity r-${i.rarity}">${t(`rarity.${i.rarity}`)}</span>`;
      if (car && preview)
        preview.show(
          car.carId,
          i.slot === 'look'
            ? { ...car.visual, look: i.value }
            : { ...car.visual, look: 'none', [i.slot]: i.value },
          car.parts,
        );
      act.hidden = false;
      act.disabled = false;
      if (i.owned) {
        act.textContent = worn(i) ? t('shop.worn') : t('shop.wear');
        act.disabled = worn(i) || !car;
      } else if (i.price > tokens) {
        act.textContent = t('shop.need', { n: i.price - tokens });
        act.disabled = true;
      } else act.textContent = t('shop.buyFor', { n: i.price });
      grid();
    };
    const wear = async (i: Item) => {
      if (!car) return;
      const body = i.slot === 'look' ? { look: i.value } : { [i.slot]: i.value, look: 'none' };
      car = await api<OwnedCar>(`/api/garage/cars/${car.id}/visual`, { method: 'PUT', body });
    };
    act.onclick = async () => {
      if (!picked) return;
      const i = picked;
      act.disabled = true;
      try {
        if (!i.owned) {
          await api(`/api/shop/cosmetics/${i.id}/buy`, { body: {} });
          notice = t('shop.bought');
        }
        await wear(i);
        void render();
      } catch (e) {
        msg.textContent = errText(e);
        act.disabled = false;
      }
    };
    const grid = () => {
      const box = $('grid');
      const list = items
        .filter((i) => tabOfSlot(i.slot) === tab)
        .sort(
          (a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || a.price - b.price,
        );
      box.innerHTML = list.length
        ? list
            .map(
              (i) =>
                `<button class="btn item r-${i.rarity} ${picked?.id === i.id ? 'sel' : ''}" data-item="${i.id}">${escapeHtml(itemName(i))}<small>${
                  i.owned
                    ? worn(i)
                      ? t('shop.worn')
                      : t('shop.owned')
                    : t('shop.price', { n: i.price })
                } · ${t(`rarity.${i.rarity}`)}</small></button>`,
            )
            .join('')
        : `<p class="sub">${t('shop.tabEmpty')}</p>`;
      box.querySelectorAll<HTMLElement>('[data-item]').forEach((b) => {
        b.onclick = () => tryOn(items.find((i) => i.id === b.dataset.item)!);
      });
    };
    panel.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => {
      b.onclick = () => {
        tab = b.dataset.tab as ShopTab;
        panel.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('sel', x === b));
        grid();
      };
    });
    grid();
  };
  void render();
}
