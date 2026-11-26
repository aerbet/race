import { escapeHtml } from '../ui/menu';
import { account } from './account';
import { ApiError, api, newKey, wallet } from './api';

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

const PROVIDER_NAMES: Record<string, string> = {
  cryptobot: 'Telegram · крипта (USDT/TON)',
  sbp: 'СБП',
};
const SLOT_NAMES: Record<string, string> = {
  paint: 'Краска',
  neon: 'Неон',
  vinyl: 'Винил',
  rims: 'Диски',
  spoiler: 'Антикрыло',
  kit: 'Кузов',
};

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
    msg.textContent = 'Ждём подтверждения оплаты…';
    polling = window.setInterval(async () => {
      try {
        const p = await api<PaymentView>(`/api/payments/${id}`);
        if (p.status === 'paid') {
          clearInterval(polling);
          notice = `Оплачено: +${p.tokens} жетонов`;
          void render();
        } else if (p.status === 'failed' || p.status === 'expired') {
          clearInterval(polling);
          msg.textContent = p.status === 'failed' ? 'Оплата не прошла' : 'Счёт истёк';
        } else if (Date.now() - started > 15 * 60_000) {
          clearInterval(polling);
          msg.textContent =
            'Подтверждение задерживается — жетоны придут автоматически после оплаты.';
        }
      } catch {
        /* сеть — попробуем на следующем тике */
      }
    }, 3000);
  };

  const render = async (): Promise<void> => {
    if (!account.token) {
      panel.innerHTML = `<p class="big" style="font:900 italic 30px var(--font);margin:0">Магазин</p>
        <p class="sub">Войдите в аккаунт, чтобы покупать.</p><div class="btnrow"><button class="btn" data-k="back">Назад</button></div>`;
      (panel.querySelector('[data-k="back"]') as HTMLElement).onclick = close;
      return;
    }
    panel.innerHTML = `<p class="sub">Загрузка…</p>`;
    let offers: Offer[], items: Item[], tokens: number;
    try {
      [offers, items, tokens] = await Promise.all([
        api<Offer[]>('/api/shop/products', { auth: false }),
        api<Item[]>('/api/shop/cosmetics'),
        wallet().then((w) => w.tokens),
      ]);
    } catch (e) {
      panel.innerHTML = `<p class="sub">${escapeHtml(e instanceof ApiError ? e.message : 'Ошибка')}</p><div class="btnrow"><button class="btn" data-k="back">Назад</button></div>`;
      (panel.querySelector('[data-k="back"]') as HTMLElement).onclick = close;
      return;
    }
    const anyProvider = offers.some((o) => Object.keys(o.prices).length > 0);
    panel.innerHTML = `<p class="big" style="font:900 italic 30px var(--font);margin:0">Магазин</p>
      <p class="sub">Жетоны: <b>${tokens}</b> · за жетоны — только внешний вид, на скорость не влияет</p>
      <h2>Жетоны</h2>
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
                      `<button class="btn" data-pay="${o.id}" data-prov="${prov}">${PROVIDER_NAMES[prov] ?? prov}<small>${pr.amount} ${pr.currency === 'RUB' ? '₽' : '$'}</small></button>`,
                  )
                  .join('')}</div>`,
              )
              .join('')}</div>`
          : '<p class="sub">Оплата пока не подключена на сервере.</p>'
      }
      <p class="sub" data-k="msg"></p>
      <h2>Косметика</h2>
      <table>${items
        .map(
          (i) =>
            `<tr><td>${SLOT_NAMES[i.slot] ?? i.slot}</td><td>${escapeHtml(i.name)}</td><td>${
              i.owned
                ? 'куплено'
                : `<button class="btn" data-buy="${i.id}" ${i.price > tokens ? 'disabled' : ''}>${i.price} жет.</button>`
            }</td></tr>`,
        )
        .join('')}</table>
      <p class="hint">Купленное ставится в «Гараже». Оплата проходит у провайдера (Telegram @CryptoBot или банк через СБП); после оплаты вернитесь в игру — жетоны начислятся автоматически.</p>
      <div class="btnrow"><button class="btn" data-k="back">Готово</button></div>`;
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
          msg.textContent = e instanceof ApiError ? e.message : 'Не удалось создать платёж';
        }
      };
    });
    panel.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => {
      b.onclick = async () => {
        try {
          await api(`/api/shop/cosmetics/${b.dataset.buy}/buy`, { body: {} });
          void render();
        } catch (e) {
          msg.textContent = e instanceof ApiError ? e.message : 'Ошибка';
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
