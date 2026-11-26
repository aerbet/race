import type { Rapier } from '@sr/physics';
import { t, CAR_IDS } from '@sr/shared';

/** Слепой тест — три машины разных схем привода (rwd / fwd / awd), а не весь автопарк. */
const BLIND_IDS = ['era2000_coupe', 'era2026_hatch', 'kaizen_rx34'].filter((id) =>
  CAR_IDS.includes(id),
);
import { App } from '../app';
import type { Quality } from '../render/quality';
import { escapeHtml } from './menu';
import { api, newKey } from '../meta/api';

export const QUESTIONS = [
  { id: 'smooth' },
  { id: 'responsive' },
  { id: 'drift' },
  { id: 'speed' },
  { id: 'more' },
] as const;

export interface BlindResult {
  tester: string;
  /** Метка, которую видел тестер. */
  label: string;
  /** Настоящая машина (тестер её не видит). */
  carId: string;
  order: number;
  driveSeconds: number;
  device: string;
  scores: Record<(typeof QUESTIONS)[number]['id'], number>;
  comment: string;
  date: string;
  userAgent: string;
}

const KEY = 'sr:blind-results';

export function loadResults(): BlindResult[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as BlindResult[];
  } catch {
    return [];
  }
}
function saveResults(r: BlindResult[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* без хранилища — результаты останутся только в скачанном файле */
  }
}

export function averages(results: BlindResult[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const byCar = new Map<string, BlindResult[]>();
  for (const r of results) byCar.set(r.carId, [...(byCar.get(r.carId) ?? []), r]);
  for (const [car, rs] of byCar) {
    out[car] = {};
    for (const q of QUESTIONS)
      out[car]![q.id] = rs.reduce((s, r) => s + r.scores[q.id], 0) / rs.length;
    out[car]!.n = rs.length;
  }
  return out;
}

const LABELS = ['A', 'B', 'C', 'D'];
const MIN_DRIVE_SECONDS = 60;

/** Сборка для слепого теста: выбор машины (под буквой) → полигон → форма оценки. */
export class BlindTest {
  private app: App;
  private screen: HTMLElement | null = null;
  private tester = '';
  private session = '';
  private order: string[] = [];
  private idx = 0;
  private driveStart = 0;

  constructor(
    R: Rapier,
    readonly root: HTMLElement,
    quality: Quality,
  ) {
    this.app = new App(Promise.resolve(R), root, quality);
  }

  start(): void {
    this.intro();
  }

  private show(html: string): HTMLElement {
    this.screen?.remove();
    const el = document.createElement('div');
    el.className = 'screen';
    el.innerHTML = `<div class="menu panel">${html}</div>`;
    this.root.appendChild(el);
    this.screen = el;
    el.querySelectorAll('input,textarea').forEach((i) =>
      i.addEventListener('keydown', (e) => e.stopPropagation()),
    );
    return el;
  }

  private intro(): void {
    const all = loadResults();
    const el = this.show(`
      <p class="big" style="font:900 italic 34px var(--font);margin:0">${t('blind.title')}</p>
      <p class="sub">${t('blind.sub', { n: BLIND_IDS.length, s: MIN_DRIVE_SECONDS })}</p>
      <h2>${t('blind.tester')}</h2>
      <input type="text" maxlength="24" data-k="name" placeholder="T-07" />
      <button class="btn primary" data-k="go">${t('blind.start')}</button>
      <div class="btnrow">
        <button class="btn" data-k="dl">${t('blind.download', { n: all.length })}</button>
        <button class="btn" data-k="sum">${t('blind.summary')}</button>
      </div>
      <p class="hint">${t('blind.hint')}</p>`);
    const name = el.querySelector('[data-k="name"]') as HTMLInputElement;
    (el.querySelector('[data-k="go"]') as HTMLElement).onclick = () => {
      this.tester = name.value.trim() || `T-${Date.now().toString(36)}`;
      // Анонимный id прохода: на сервер уходит только он, не имя
      this.session = newKey();
      // Случайный порядок машин для каждого тестера
      this.order = [...BLIND_IDS].sort(() => Math.random() - 0.5);
      this.idx = 0;
      this.drive();
    };
    (el.querySelector('[data-k="dl"]') as HTMLElement).onclick = () => this.download();
    (el.querySelector('[data-k="sum"]') as HTMLElement).onclick = () => void this.summary();
  }

  private drive(): void {
    this.screen?.remove();
    this.screen = null;
    const carId = this.order[this.idx]!;
    this.app.start({
      mode: 'free',
      trackId: 'polygon',
      carId,
      bots: 0,
      botLevel: 'medium',
      laps: 999,
      manual: false,
      playerName: this.tester,
    });
    this.driveStart = performance.now();
    const label = LABELS[this.idx]!;
    const bar = document.createElement('div');
    bar.style.cssText =
      'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:25;display:flex;gap:8px;align-items:center';
    bar.innerHTML = `<span class="btn" style="pointer-events:none">${t('blind.car', { label })}</span><button class="btn" data-k="rate" disabled>${t('blind.rate')}</button>`;
    this.root.appendChild(bar);
    const rate = bar.querySelector('[data-k="rate"]') as HTMLButtonElement;
    const tick = setInterval(() => {
      const s = (performance.now() - this.driveStart) / 1000;
      if (s >= MIN_DRIVE_SECONDS) {
        rate.disabled = false;
        rate.textContent = t('blind.rate');
      } else rate.textContent = t('blind.rateIn', { n: Math.ceil(MIN_DRIVE_SECONDS - s) });
    }, 250);
    rate.onclick = () => {
      clearInterval(tick);
      bar.remove();
      const seconds = (performance.now() - this.driveStart) / 1000;
      const device = this.app.input.device;
      this.app.endRace();
      this.form(label, carId, seconds, device);
    };
  }

  private form(label: string, carId: string, seconds: number, device: string): void {
    const qs = QUESTIONS.map(
      (q) =>
        `<h2>${t(`blind.q.${q.id}`)}</h2><div class="row" data-q="${q.id}">${[1, 2, 3, 4, 5]
          .map(
            (n) =>
              `<button class="btn" data-v="${n}" style="flex:1;text-align:center">${n}</button>`,
          )
          .join('')}</div>`,
    ).join('');
    const el = this
      .show(`<p class="big" style="font:900 italic 30px var(--font);margin:0">${t('blind.car', { label })}</p>
      <p class="sub">${t('blind.scale')}</p>${qs}
      <h2>${t('blind.comment')}</h2><input type="text" maxlength="300" data-k="comment" />
      <button class="btn primary" data-k="save" disabled>${t('blind.save')}</button>`);
    const scores: Record<string, number> = {};
    const save = el.querySelector('[data-k="save"]') as HTMLButtonElement;
    el.querySelectorAll('[data-q]').forEach((row) => {
      row.querySelectorAll('[data-v]').forEach((b) => {
        (b as HTMLElement).onclick = () => {
          row.querySelectorAll('[data-v]').forEach((x) => x.classList.remove('sel'));
          b.classList.add('sel');
          scores[(row as HTMLElement).dataset.q!] = Number((b as HTMLElement).dataset.v);
          save.disabled = Object.keys(scores).length < QUESTIONS.length;
        };
      });
    });
    save.onclick = () => {
      const all = loadResults();
      all.push({
        tester: this.tester,
        label,
        carId,
        order: this.idx,
        driveSeconds: Math.round(seconds),
        device,
        scores: scores as BlindResult['scores'],
        comment: (el.querySelector('[data-k="comment"]') as HTMLInputElement).value,
        date: new Date().toISOString(),
        userAgent: navigator.userAgent,
      });
      saveResults(all);
      void this.upload(all[all.length - 1]!);
      this.idx++;
      if (this.idx < this.order.length) this.drive();
      else this.thanks();
    };
  }

  private thanks(): void {
    const el = this
      .show(`<p class="big" style="font:900 italic 34px var(--font);margin:0">${t('blind.thanks')}</p>
      <p class="sub">${t('blind.thanks.sub')}</p>
      <div class="btnrow"><button class="btn" data-k="next">${t('blind.next')}</button><button class="btn" data-k="dl">${t('blind.json')}</button></div>`);
    (el.querySelector('[data-k="next"]') as HTMLElement).onclick = () => this.intro();
    (el.querySelector('[data-k="dl"]') as HTMLElement).onclick = () => this.download();
  }

  /** Отправка оценки на сервер (анонимно). Без сети — остаётся локально, можно скачать JSON. */
  private async upload(r: BlindResult): Promise<void> {
    try {
      await api('/api/blind', {
        auth: false,
        body: {
          sessionId: this.session,
          carId: r.carId,
          label: r.label,
          order: r.order,
          driveSeconds: r.driveSeconds,
          device: r.device,
          scores: r.scores,
          comment: r.comment,
        },
      });
    } catch {
      /* сервер недоступен — результат есть в браузере */
    }
  }

  private async summary(): Promise<void> {
    // Сначала общая сводка с сервера, без сети — по этому браузеру
    let avg = averages(loadResults());
    let source = t('blind.local');
    try {
      const srv = await api<{
        testers: number;
        cars: (Record<string, number> & { car_id: string; n: number })[];
      }>('/api/blind/summary', { auth: false });
      if (srv.cars.length) {
        avg = Object.fromEntries(srv.cars.map((c) => [c.car_id, c]));
        source = t('blind.all', { n: srv.testers });
      }
    } catch {
      /* офлайн */
    }
    const rows = Object.entries(avg)
      .map(
        ([car, a]) =>
          `<tr><td>${escapeHtml(car)} (${a.n})</td>${QUESTIONS.map(
            (q) =>
              `<td style="color:${a[q.id]! >= 4 ? '#8cff3a' : '#ff7088'}">${a[q.id]!.toFixed(2)}</td>`,
          ).join('')}</tr>`,
      )
      .join('');
    const el = this
      .show(`<div class="results"><p class="big" style="font:900 italic 30px var(--font);margin:0">${t('blind.summary')}</p>
      <p class="sub">${t('blind.goal')} · ${source}</p>
      <table><tr><th>${t('menu.car')}</th>${QUESTIONS.map((q) => `<th>${q.id}</th>`).join('')}</tr>${rows}</table>
      <div class="btnrow"><button class="btn" data-k="back">${t('ui.back')}</button></div></div>`);
    (el.querySelector('[data-k="back"]') as HTMLElement).onclick = () => this.intro();
  }

  private download(): void {
    const data = {
      exported: new Date().toISOString(),
      results: loadResults(),
      averages: averages(loadResults()),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    a.download = `blind-test-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }
}
