import { getLang, has, t, tn } from '@sr/shared';
import { escapeHtml } from '../ui/menu';
import { account } from './account';
import { api, errText, newKey, wallet } from './api';

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
}
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
const slotName = (s: string) => (has(`slot.${s}`) ? t(`slot.${s}`) : s);
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
  /** Сообщение переживает перерисовку экрана (после оплаты список обновляется). */
  let notice = '';
  const close = () => {
    clearInterval(polling);
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
          void render();
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
      void render();
    };
    panel.querySelectorAll<HTMLElement>('[data-prov]').forEach((b) => {
      b.onclick = () => void pay(o, b.dataset.prov!, msg);
    });
  };

  const render = async (): Promise<void> => {
    if (!account.token) {
      panel.innerHTML = `<p class="big" style="font:900 italic 30px var(--font);margin:0">${t('menu.shop')}</p>
        <p class="sub">${t('shop.login')}</p><div class="btnrow"><button class="btn" data-k="back">${t('ui.back')}</button></div>`;
      $('back').onclick = close;
      return;
    }
    panel.innerHTML = `<p class="sub">${t('ui.loading')}</p>`;
    let offers: Offer[], items: Item[], tokens: number;
    try {
      [offers, items, tokens] = await Promise.all([
        api<Offer[]>('/api/shop/products', { auth: false }),
        api<Item[]>('/api/shop/cosmetics'),
        wallet().then((w) => w.tokens),
      ]);
    } catch (e) {
      panel.innerHTML = `<p class="sub">${escapeHtml(errText(e))}</p><div class="btnrow"><button class="btn" data-k="back">${t('ui.back')}</button></div>`;
      $('back').onclick = close;
      return;
    }
    const buyable = offers.filter((o) => Object.keys(o.prices).length > 0);
    panel.innerHTML = `<p class="big" style="font:900 italic 30px var(--font);margin:0">${t('menu.shop')}</p>
      <p class="sub">${t('shop.tokens', { n: `<b>${tokens}</b>` })}</p>
      <h2>${t('shop.packs')}</h2>
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
      <h2>${t('shop.looks')}</h2>
      <table>${items
        .map(
          (i) =>
            `<tr><td>${slotName(i.slot)}</td><td>${escapeHtml(itemName(i))}</td><td>${
              i.owned
                ? t('shop.owned')
                : `<button class="btn" data-buy="${i.id}" ${i.price > tokens ? 'disabled' : ''}>${t('shop.price', { n: i.price })}</button>`
            }</td></tr>`,
        )
        .join('')}</table>
      <p class="hint">${t('shop.hint')}</p>
      <div class="btnrow"><button class="btn" data-k="back">${t('ui.done')}</button></div>`;
    const msg = $('msg');
    msg.textContent = notice;
    $('back').onclick = close;
    panel.querySelectorAll<HTMLElement>('[data-pack]').forEach((b) => {
      b.onclick = () => choose(buyable.find((o) => o.id === b.dataset.pack)!);
    });
    panel.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => {
      b.onclick = async () => {
        try {
          await api(`/api/shop/cosmetics/${b.dataset.buy}/buy`, { body: {} });
          void render();
        } catch (e) {
          msg.textContent = errText(e);
        }
      };
    });
    if (returnedPayment) {
      const id = returnedPayment;
      returnedPayment = undefined;
      waitFor(id, msg);
    }
  };
  void render();
}
