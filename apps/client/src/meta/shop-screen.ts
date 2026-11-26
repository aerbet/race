import { t, tn, has } from '@sr/shared';
import { escapeHtml } from '../ui/menu';
import { account } from './account';
import { api, errText, newKey, wallet } from './api';

interface Offer {
  id: string;
  name: string;
  tokens: number;
  badge?: string;
  prices: Record<string, { amount: string; currency: string }>;
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

const provName = (p: string) => (has(`pay.${p}`) ? t(`pay.${p}`) : p);
const slotName = (s: string) => (has(`slot.${s}`) ? t(`slot.${s}`) : s);

function h(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

/**
 * Магазин: пакеты жетонов (Telegram Crypto Pay, СБП) и косметика за жетоны.
 * Оплата открывается в новой вкладке; экран опрашивает статус, пока провайдер не подтвердит.
 */
export function showShop(root: HTMLElement, done: () => void, returnedPayment?: string): void {
  const el = h(
    `<div class="screen meta"><div class="menu panel results" data-k="panel"></div></div>`,
  );
  root.appendChild(el);
  const panel = el.querySelector('[data-k="panel"]') as HTMLElement;
  let polling = 0;
  /** Сообщение переживает перерисовку экрана (после оплаты список обновляется). */
  let notice = '';
  const close = () => {
    clearInterval(polling);
    el.remove();
    done();
  };

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

  const render = async (): Promise<void> => {
    if (!account.token) {
      panel.innerHTML = `<p class="big" style="font:900 italic 30px var(--font);margin:0">${t('menu.shop')}</p>
        <p class="sub">${t('shop.login')}</p><div class="btnrow"><button class="btn" data-k="back">${t('ui.back')}</button></div>`;
      (panel.querySelector('[data-k="back"]') as HTMLElement).onclick = close;
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
      (panel.querySelector('[data-k="back"]') as HTMLElement).onclick = close;
      return;
    }
    const anyProvider = offers.some((o) => Object.keys(o.prices).length > 0);
    panel.innerHTML = `<p class="big" style="font:900 italic 30px var(--font);margin:0">${t('menu.shop')}</p>
      <p class="sub">${t('shop.tokens', { n: `<b>${tokens}</b>` })}</p>
      <h2>${t('shop.packs')}</h2>
      ${
        anyProvider
          ? `<div class="grid2">${offers
              .map(
                (
                  o,
                ) => `<div class="offer"><b>${escapeHtml(o.name)}</b>${o.badge ? ` <span class="badge">${escapeHtml(o.badge)}</span>` : ''}
                ${Object.entries(o.prices)
                  .map(
                    ([prov, pr]) =>
                      `<button class="btn" data-pay="${o.id}" data-prov="${prov}">${provName(prov)}<small>${pr.amount} ${pr.currency === 'RUB' ? '₽' : '$'}</small></button>`,
                  )
                  .join('')}</div>`,
              )
              .join('')}</div>`
          : `<p class="sub">${t('shop.noPay')}</p>`
      }
      <p class="sub" data-k="msg"></p>
      <h2>${t('shop.looks')}</h2>
      <table>${items
        .map(
          (i) =>
            `<tr><td>${slotName(i.slot)}</td><td>${escapeHtml(i.name)}</td><td>${
              i.owned
                ? t('shop.owned')
                : `<button class="btn" data-buy="${i.id}" ${i.price > tokens ? 'disabled' : ''}>${t('shop.price', { n: i.price })}</button>`
            }</td></tr>`,
        )
        .join('')}</table>
      <p class="hint">${t('shop.hint')}</p>
      <div class="btnrow"><button class="btn" data-k="back">${t('ui.done')}</button></div>`;
    const msg = panel.querySelector('[data-k="msg"]') as HTMLElement;
    msg.textContent = notice;
    (panel.querySelector('[data-k="back"]') as HTMLElement).onclick = close;
    panel.querySelectorAll<HTMLElement>('[data-pay]').forEach((b) => {
      b.onclick = async () => {
        // Окно открываем сразу по клику (иначе браузер заблокирует всплывающее)
        const win = window.open('', '_blank');
        try {
          const p = await api<PaymentView>('/api/payments', {
            body: { productId: b.dataset.pay, provider: b.dataset.prov },
            key: newKey(),
          });
          if (win) win.location.href = p.payUrl;
          else location.href = p.payUrl;
          waitFor(p.id, msg);
        } catch (e) {
          win?.close();
          msg.textContent = errText(e);
        }
      };
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
