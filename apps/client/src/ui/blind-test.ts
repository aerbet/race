import type { Rapier } from '@sr/physics';
import { CAR_IDS } from '@sr/shared';

/** Слепой тест — три машины разных схем привода (rwd / fwd / awd), а не весь автопарк. */
const BLIND_IDS = ['era2000_coupe', 'era2026_hatch', 'kaizen_rx34'].filter((id) =>
  CAR_IDS.includes(id),
);
import { App } from '../app';
import type { Quality } from '../render/quality';
import { escapeHtml } from './menu';

export const QUESTIONS = [
  { id: 'smooth', text: 'Плавность управления' },
  { id: 'responsive', text: 'Отзывчивость (машина делает то, что я хочу)' },
  { id: 'drift', text: 'Дрифт (легко войти, удержать и выйти)' },
  { id: 'speed', text: 'Ощущение скорости' },
  { id: 'more', text: 'Хочется поиграть ещё' },
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
  private order: string[] = [];
  private idx = 0;
  private driveStart = 0;

  constructor(
    R: Rapier,
    readonly root: HTMLElement,
    quality: Quality,
  ) {
    this.app = new App(R, root, quality);
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
      <p class="big" style="font:900 italic 34px var(--font);margin:0">Слепой тест управления</p>
      <p class="sub">Вы прокатитесь на ${BLIND_IDS.length} машинах под буквами. После каждой — 5 вопросов по шкале 1–5.
      Мин. ${MIN_DRIVE_SECONDS} с езды на машину. Полигон: прямая с трамплином, шпилька, S-повороты, дрифт-круг.</p>
      <h2>Имя или номер тестера</h2>
      <input type="text" maxlength="24" data-k="name" placeholder="например, Т-07" />
      <button class="btn primary" data-k="go">Начать</button>
      <div class="btnrow">
        <button class="btn" data-k="dl">Скачать результаты (${all.length})</button>
        <button class="btn" data-k="sum">Сводка</button>
      </div>
      <p class="hint">Результаты хранятся в этом браузере, пока не скачаны. Управление: W/S/A/D, пробел — резкий тормоз (с газом и рулём — занос), Shift — нитро, R — сброс. Геймпад и сенсор тоже работают.</p>`);
    const name = el.querySelector('[data-k="name"]') as HTMLInputElement;
    (el.querySelector('[data-k="go"]') as HTMLElement).onclick = () => {
      this.tester = name.value.trim() || `T-${Date.now().toString(36)}`;
      // Случайный порядок машин для каждого тестера
      this.order = [...BLIND_IDS].sort(() => Math.random() - 0.5);
      this.idx = 0;
      this.drive();
    };
    (el.querySelector('[data-k="dl"]') as HTMLElement).onclick = () => this.download();
    (el.querySelector('[data-k="sum"]') as HTMLElement).onclick = () => this.summary();
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
    bar.innerHTML = `<span class="btn" style="pointer-events:none">Машина ${label}</span><button class="btn" data-k="rate" disabled>Оценить</button>`;
    this.root.appendChild(bar);
    const rate = bar.querySelector('[data-k="rate"]') as HTMLButtonElement;
    const tick = setInterval(() => {
      const s = (performance.now() - this.driveStart) / 1000;
      if (s >= MIN_DRIVE_SECONDS) {
        rate.disabled = false;
        rate.textContent = 'Оценить';
      } else rate.textContent = `Оценить (${Math.ceil(MIN_DRIVE_SECONDS - s)} с)`;
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
        `<h2>${q.text}</h2><div class="row" data-q="${q.id}">${[1, 2, 3, 4, 5]
          .map(
            (n) =>
              `<button class="btn" data-v="${n}" style="flex:1;text-align:center">${n}</button>`,
          )
          .join('')}</div>`,
    ).join('');
    const el = this
      .show(`<p class="big" style="font:900 italic 30px var(--font);margin:0">Машина ${label}</p>
      <p class="sub">1 — плохо, 5 — отлично</p>${qs}
      <h2>Комментарий (необязательно)</h2><input type="text" maxlength="300" data-k="comment" />
      <button class="btn primary" data-k="save" disabled>Сохранить</button>`);
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
      this.idx++;
      if (this.idx < this.order.length) this.drive();
      else this.thanks();
    };
  }

  private thanks(): void {
    const el = this
      .show(`<p class="big" style="font:900 italic 34px var(--font);margin:0">Спасибо!</p>
      <p class="sub">Ответы сохранены. Передайте устройство следующему тестеру.</p>
      <div class="btnrow"><button class="btn" data-k="next">Следующий тестер</button><button class="btn" data-k="dl">Скачать JSON</button></div>`);
    (el.querySelector('[data-k="next"]') as HTMLElement).onclick = () => this.intro();
    (el.querySelector('[data-k="dl"]') as HTMLElement).onclick = () => this.download();
  }

  private summary(): void {
    const avg = averages(loadResults());
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
      .show(`<div class="results"><p class="big" style="font:900 italic 30px var(--font);margin:0">Сводка</p>
      <p class="sub">Цель — ≥ 4,0 по каждому пункту.</p>
      <table><tr><th>Машина</th>${QUESTIONS.map((q) => `<th>${q.id}</th>`).join('')}</tr>${rows}</table>
      <div class="btnrow"><button class="btn" data-k="back">Назад</button></div></div>`);
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
