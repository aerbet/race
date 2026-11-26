import * as THREE from 'three';
import type { CarConfig } from '@sr/shared';
import {
  carKitParam,
  carModelParam,
  loadCarKit,
  loadCarModel,
  mergeStatic,
  splitCarModel,
} from './car-model';
import { applyModelPaint, paintMaterial } from './paint';
import { getQuality } from './quality';

/**
 * Процедурная модель машины (собственная, без внешних ассетов).
 * Кузов — «лофт» сечений вдоль длины: скруглённые борта (суперэллипс), сужающаяся к крыше
 * кабина, вырезы арок над колёсами. Перед машины — −Z, центр кузова — начало координат.
 */

/** Кривая по ключевым точкам [u, значение] с плавной (smoothstep) интерполяцией. */
function curve(pts: [number, number][]): (u: number) => number {
  return (u) => {
    if (u <= pts[0]![0]) return pts[0]![1];
    for (let i = 1; i < pts.length; i++) {
      const [u1, v1] = pts[i]!;
      if (u <= u1) {
        const [u0, v0] = pts[i - 1]!;
        let t = (u - u0) / (u1 - u0);
        t = t * t * (3 - 2 * t);
        return v0 + (v1 - v0) * t;
      }
    }
    return pts[pts.length - 1]![1];
  };
}

interface BodyShape {
  /** Полуширина (доля от W/2). */
  width: (u: number) => number;
  /** Линия плеча/капота (доля высоты от низа). */
  belt: (u: number) => number;
  /** Верх: крыша/капот (доля высоты). */
  top: (u: number) => number;
  /** Зона остекления по длине. */
  glass: [number, number];
  /** Сужение кабины к крыше. */
  taper: number;
}

const SHAPES: Record<string, BodyShape> = {
  // «Нулевые»: длинный капот, низкая крыша, фастбэк
  '2000': {
    width: curve([
      [0, 0.78],
      [0.06, 0.93],
      [0.2, 1],
      [0.8, 1],
      [0.95, 0.95],
      [1, 0.84],
    ]),
    belt: curve([
      [0, 0.36],
      [0.08, 0.46],
      [0.35, 0.52],
      [0.7, 0.54],
      [0.95, 0.56],
      [1, 0.5],
    ]),
    top: curve([
      [0, 0.38],
      [0.06, 0.5],
      [0.3, 0.57],
      [0.36, 0.6],
      [0.5, 0.97],
      [0.66, 0.98],
      [0.86, 0.66],
      [0.96, 0.6],
      [1, 0.52],
    ]),
    glass: [0.36, 0.86],
    taper: 0.74,
  },
  // «2026»: короткий нос, высокая крыша, рубленая корма хэтчбека
  '2026': {
    width: curve([
      [0, 0.8],
      [0.07, 0.95],
      [0.2, 1],
      [0.85, 1],
      [0.97, 0.94],
      [1, 0.86],
    ]),
    belt: curve([
      [0, 0.4],
      [0.08, 0.5],
      [0.3, 0.56],
      [0.8, 0.6],
      [1, 0.58],
    ]),
    top: curve([
      [0, 0.42],
      [0.07, 0.55],
      [0.22, 0.62],
      [0.3, 0.66],
      [0.45, 1],
      [0.86, 0.98],
      [0.95, 0.88],
      [1, 0.62],
    ]),
    glass: [0.3, 0.95],
    taper: 0.8,
  },
};

export interface CarViewOptions {
  /** Цвет краски (если `paint` не задан или это #rrggbb). */
  color: number;
  /** Неон: цвет, null/undefined — без неона. */
  neon?: number;
  ghost?: boolean;
  /** Краска: #rrggbb или премиум: chrome | pearl | matte_black | chameleon. */
  paint?: string;
  /** Неон-эффект: rainbow | pulse (поверх цвета). */
  neonFx?: string;
  vinyl?: string;
  rims?: string;
  spoiler?: string;
  /** Кузовной кит glTF-модели (stock | id из cfg.kits). */
  kit?: string;
  /** Второй цвет (#rrggbb) — детали с маской accent. */
  paint2?: string;
}

let glowCache: THREE.Texture | null = null;
function makeGlow(): THREE.Texture {
  if (glowCache) return glowCache;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowCache = new THREE.CanvasTexture(c);
  return glowCache;
}

/** Кузов + стекло: один лофт, две группы материалов. */
function buildBody(
  cfg: CarConfig,
  shape: BodyShape,
  wheelCenters: { z: number; y: number }[],
  R: number,
): THREE.BufferGeometry {
  const { width: W, height: H, length: L } = cfg.body;
  const S = 72; // сечений
  const M = 32; // точек сечения
  const bottom = -H / 2 + 0.05 * H;
  const pos: number[] = [];
  const uv: number[] = [];
  const glassFlag: number[] = [];
  for (let i = 0; i <= S; i++) {
    const u = i / S;
    const z = -L / 2 + u * L;
    const hw = (W / 2) * shape.width(u);
    const belt = -H / 2 + H * shape.belt(u);
    const top = Math.max(belt + 0.07 * H, -H / 2 + H * shape.top(u));
    // Вырез арки: низ кузова поднимается над колесом полукругом
    let bot = bottom;
    for (const w of wheelCenters) {
      const dz = z - w.z;
      const r = R + 0.06;
      if (Math.abs(dz) < r) bot = Math.max(bot, w.y + Math.sqrt(r * r - dz * dz));
    }
    bot = Math.min(bot, belt - 0.05);
    const cabin = top - belt > 0.18 * H && u > shape.glass[0] && u < shape.glass[1];
    for (let j = 0; j < M; j++) {
      const v = j / M;
      const th = -Math.PI / 2 + v * Math.PI * 2;
      const c = Math.cos(th),
        sn = Math.sin(th);
      if (sn < 0) {
        // Нижняя часть: почти прямоугольная, скруглённые рёбра
        const e = 2 / 5;
        const xs = Math.sign(c) * Math.abs(c) ** e;
        const ys = Math.sign(sn) * Math.abs(sn) ** e;
        pos.push(xs * hw, belt + ys * (belt - bot), z);
      } else {
        // Верх: кабина сужается к крыше (завал боковин)
        const e = cabin ? 2 / 3.2 : 2 / 3.5;
        const xs = Math.sign(c) * Math.abs(c) ** e;
        const ys = Math.abs(sn) ** e;
        const taper = cabin ? 1 + (shape.taper - 1) * ys : 1 - 0.06 * ys;
        pos.push(xs * hw * taper, belt + ys * (top - belt), z);
      }
      uv.push(u, v);
      // Стекло: боковины кабины и лобовое/заднее, крыша остаётся окрашенной
      const ysAbs = sn > 0 ? Math.abs(sn) : 0;
      glassFlag.push(cabin && ysAbs > 0.2 && ysAbs < 0.93 ? 1 : 0);
    }
  }
  const idxPaint: number[] = [];
  const idxGlass: number[] = [];
  const at = (i: number, j: number) => i * M + (j % M);
  for (let i = 0; i < S; i++)
    for (let j = 0; j < M; j++) {
      const a = at(i, j),
        b = at(i + 1, j),
        c2 = at(i + 1, j + 1),
        d = at(i, j + 1);
      const glass = glassFlag[a]! + glassFlag[b]! + glassFlag[c2]! + glassFlag[d]! >= 3;
      // Лобовое и заднее стекло — где кабина начинается/заканчивается
      (glass ? idxGlass : idxPaint).push(a, d, b, b, d, c2);
    }
  // Торцы
  const base = pos.length / 3;
  for (const [i, sign] of [
    [0, -1],
    [S, 1],
  ] as const) {
    let cx = 0,
      cy = 0,
      cz = 0;
    for (let j = 0; j < M; j++) {
      cx += pos[at(i, j) * 3]!;
      cy += pos[at(i, j) * 3 + 1]!;
      cz += pos[at(i, j) * 3 + 2]!;
    }
    pos.push(cx / M, cy / M, cz / M + sign * 0.03);
    uv.push(i / S, 0.5);
    const center = pos.length / 3 - 1;
    for (let j = 0; j < M; j++) {
      if (sign < 0) idxPaint.push(center, at(i, j + 1), at(i, j));
      else idxPaint.push(center, at(i, j), at(i, j + 1));
    }
  }
  void base;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...idxPaint, ...idxGlass]);
  g.addGroup(0, idxPaint.length, 0);
  g.addGroup(idxPaint.length, idxGlass.length, 1);
  g.computeVertexNormals();
  return g;
}

/** Шина со скруглённой боковиной (тело вращения вокруг X). */
function tireGeometry(R: number, w: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const ri = R * 0.64;
  const rr = Math.min(w * 0.35, R * 0.2);
  // Профиль: внутренний обод → боковина → протектор (скруглённый) → боковина
  pts.push(new THREE.Vector2(ri, -w / 2));
  pts.push(new THREE.Vector2(R - rr, -w / 2));
  for (let k = 1; k <= 4; k++) {
    const a = (k / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - rr + Math.sin(a) * rr, -w / 2 + rr - Math.cos(a) * rr));
  }
  for (let k = 0; k <= 4; k++) {
    const a = (k / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - rr + Math.cos(a) * rr, w / 2 - rr + Math.sin(a) * rr));
  }
  pts.push(new THREE.Vector2(ri, w / 2));
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Диск: обод, ступица и спицы по стилю. */
function rimGroup(
  R: number,
  w: number,
  style: string,
  mat: THREE.Material,
  dark: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();
  const rr = R * 0.62;
  const face = w / 2 - 0.015;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, w * 0.9, 24, 1, true), dark);
  barrel.rotation.z = Math.PI / 2;
  g.add(barrel);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rr - 0.012, 0.016, 6, 28), mat);
  lip.rotation.y = Math.PI / 2;
  lip.position.x = face;
  g.add(lip);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.22, rr * 0.25, 0.05, 12), mat);
  hub.rotation.z = Math.PI / 2;
  hub.position.x = face - 0.02;
  g.add(hub);
  const spoke = (angle: number, width: number, twist = 0) => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, rr * 0.82, width), mat);
    s.position.set(face - 0.02, 0, 0);
    s.geometry.translate(0, rr * 0.45, 0);
    s.rotation.set(angle, 0, 0);
    s.rotateY(twist);
    g.add(s);
  };
  if (style === 'turbine') for (let k = 0; k < 14; k++) spoke((k / 14) * Math.PI * 2, 0.035, 0.5);
  else if (style === 'mesh') {
    for (let k = 0; k < 10; k++) spoke((k / 10) * Math.PI * 2, 0.022, 0.35);
    for (let k = 0; k < 10; k++) spoke((k / 10) * Math.PI * 2, 0.022, -0.35);
  } else for (let k = 0; k < 5; k++) spoke((k / 5) * Math.PI * 2, 0.07);
  // Тормозной диск и суппорт за спицами
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.8, rr * 0.8, 0.025, 20), dark);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = face - 0.07;
  g.add(disc);
  return g;
}

export class CarView {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly wheels: THREE.Group[] = [];
  private brakeMat: THREE.MeshBasicMaterial;
  private nitroFlames: THREE.Mesh[] = [];
  private neonMat: THREE.MeshBasicMaterial | null = null;
  private neonFx = '';
  private neonBase = new THREE.Color();
  readonly cfg: CarConfig;
  private headMat: THREE.MeshBasicMaterial | null = null;
  private flashT = 0;
  /** Высота центра колеса над началом root (для посадки glTF-модели). */
  private wheelY = 0;
  private modelTail: THREE.MeshStandardMaterial | null = null;
  /** Сдвиг колёс внутрь под процедурный кузов; у glTF-модели колёса стоят по колее, как в арках. */
  private wheelInset = 0.04;
  private readonly opts: CarViewOptions;
  private readonly hi: boolean;
  /** Кит, который стоит на glTF-модели (null — сток). */
  kit: string | null = null;
  /** Крышки подъёмных фар (узлы popup_L / popup_R) и их подъём 0…1. */
  private popups: THREE.Object3D[] = [];
  private popupOpen = 0;
  private popupAt = 0;
  /** Промис загрузки glTF-модели (для гаража и тестов); null — процедурный кузов. */
  readonly ready: Promise<void> | null = null;

  constructor(cfg: CarConfig, opts: CarViewOptions) {
    this.cfg = cfg;
    this.opts = opts;
    const ghost = !!opts.ghost;
    const hi = getQuality().name === 'high';
    this.hi = hi;
    const { width: W, height: H, length: L } = cfg.body;
    const shape = SHAPES[cfg.era] ?? SHAPES['2000']!;
    const R = cfg.wheels.radius;
    const wy = cfg.wheels.mountY - cfg.suspension.restLength * 0.8;
    this.wheelY = wy;
    const wz = cfg.wheels.wheelbase / 2;
    const paint = paintMaterial(opts, hi);
    // Тонированное стекло: почти чёрное, отражения слабые — иначе на ночном небе сливается с краской
    const glass = new THREE.MeshStandardMaterial({
      color: 0x030408,
      metalness: 0.1,
      roughness: 0.12,
      transparent: ghost,
      opacity: ghost ? 0.25 : 1,
      envMapIntensity: 0.35,
    });
    const shell = new THREE.Mesh(
      buildBody(
        cfg,
        shape,
        [
          { z: -wz, y: wy },
          { z: wz, y: wy },
        ],
        R,
      ),
      [paint, glass],
    );
    shell.castShadow = !ghost;
    this.body.add(shell);

    const dark = new THREE.MeshStandardMaterial({
      color: 0x0c0d10,
      roughness: 0.7,
      transparent: ghost,
      opacity: ghost ? 0.3 : 1,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: 0x1a1c22,
      roughness: 0.45,
      metalness: 0.4,
      transparent: ghost,
      opacity: ghost ? 0.3 : 1,
    });
    const yAt = (f: (u: number) => number, u: number) => -H / 2 + H * f(u);

    if (!ghost) {
      // Фары: вытянутые «глаза» по углам носа + полоса ДХО
      const head = new THREE.MeshBasicMaterial({ color: 0xf4f7ff, toneMapped: false });
      this.headMat = head;
      const uH = 0.035;
      const hy = yAt(shape.belt, uH) + 0.02;
      for (const s of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.075, 0.12), head);
        lamp.position.set(s * (W / 2) * shape.width(uH) * 0.62, hy, -L / 2 + uH * L - 0.02);
        lamp.rotation.y = s * 0.22;
        lamp.rotation.x = -0.25;
        this.body.add(lamp);
      }
      // Решётка и нижний воздухозаборник
      const grille = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.11, 0.05), trim);
      grille.position.set(0, hy - 0.06, -L / 2 + 0.03);
      this.body.add(grille);
      const intake = new THREE.Mesh(new THREE.BoxGeometry(W * 0.62, 0.08, 0.05), dark);
      intake.position.set(0, -H / 2 + 0.2 * H, -L / 2 + 0.05);
      this.body.add(intake);
      // Стопы: LED-полоса через корму + два блока
      this.brakeMat = new THREE.MeshBasicMaterial({ color: 0x701010, toneMapped: false });
      const ty = yAt(shape.belt, 0.98) - 0.02;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.84, 0.035, 0.04), this.brakeMat);
      bar.position.set(0, ty, L / 2 - 0.005);
      this.body.add(bar);
      for (const s of [-1, 1]) {
        const blk = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.05), this.brakeMat);
        blk.position.set(s * W * 0.34, ty - 0.02, L / 2 - 0.01);
        this.body.add(blk);
      }
      // Номер (вымышленный, без надписей) и диффузор
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.11, 0.02),
        new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.6 }),
      );
      plate.position.set(0, -H / 2 + 0.32 * H, L / 2 + 0.01);
      this.body.add(plate);
      const diffuser = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.08, 0.12), dark);
      diffuser.position.set(0, -H / 2 + 0.1 * H, L / 2 - 0.04);
      this.body.add(diffuser);
      // Выхлоп
      for (const s of cfg.era === '2000' ? [1] : [-1, 1]) {
        const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.16, 12, 1, true), trim);
        ex.rotation.x = Math.PI / 2;
        ex.position.set(s * W * 0.28, -H / 2 + 0.12 * H, L / 2 + 0.02);
        this.body.add(ex);
      }
      // Зеркала
      const uM = shape.glass[0] + 0.04;
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.11), paint);
        m.position.set(
          s * ((W / 2) * shape.width(uM) * shape.taper + 0.04),
          yAt(shape.belt, uM) + 0.09,
          -L / 2 + uM * L,
        );
        this.body.add(m);
      }
      // Пороги
      for (const s of [-1, 1]) {
        const sk = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.06, cfg.wheels.wheelbase - R * 2.2),
          trim,
        );
        sk.position.set(s * (W / 2) * 0.99, -H / 2 + 0.09 * H, 0);
        this.body.add(sk);
      }
      // Антикрыло / губа
      const spoiler = opts.spoiler ?? (cfg.era === '2000' ? 'wing' : 'lip');
      const sy = yAt(shape.top, 0.97);
      if (spoiler === 'lip') {
        const lipM = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.03, 0.12), dark);
        lipM.position.set(0, sy + 0.015, L / 2 - 0.12);
        this.body.add(lipM);
      } else if (spoiler === 'wing' || spoiler === 'gt') {
        const gt = spoiler === 'gt';
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(W * (gt ? 0.98 : 0.86), 0.035, gt ? 0.34 : 0.26),
          gt ? dark : paint,
        );
        blade.position.set(0, sy + (gt ? 0.24 : 0.14), L / 2 - 0.2);
        blade.rotation.x = -0.08;
        this.body.add(blade);
        for (const s of [-1, 1]) {
          const st = new THREE.Mesh(new THREE.BoxGeometry(0.04, gt ? 0.24 : 0.14, 0.1), dark);
          st.position.set(s * W * 0.3, sy + (gt ? 0.12 : 0.07), L / 2 - 0.2);
          this.body.add(st);
          if (gt) {
            const plateE = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.38), dark);
            plateE.position.set(s * W * 0.49, sy + 0.24, L / 2 - 0.2);
            this.body.add(plateE);
          }
        }
      }
      // Неон под днищем
      if (opts.neon !== undefined) {
        this.neonMat = new THREE.MeshBasicMaterial({
          map: makeGlow(),
          color: opts.neon,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        this.neonBase.setHex(opts.neon);
        this.neonFx = opts.neonFx ?? '';
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.8, L * 1.3), this.neonMat);
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = -H / 2 - 0.25;
        glow.name = 'neon';
        this.root.add(glow);
      }
      // Пламя нитро
      const flameMat = new THREE.MeshBasicMaterial({
        color: 0x6fb8ff,
        transparent: true,
        opacity: 0.85,
        toneMapped: false,
      });
      for (const s of cfg.era === '2000' ? [1] : [-1, 1]) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.8, 8), flameMat);
        f.rotation.x = Math.PI / 2;
        f.position.set(s * W * 0.28, -H / 2 + 0.12 * H, L / 2 + 0.48);
        f.visible = false;
        this.body.add(f);
        this.nitroFlames.push(f);
      }
    } else {
      this.brakeMat = new THREE.MeshBasicMaterial();
    }
    this.root.add(this.body);

    // Колёса
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x111214,
      roughness: 0.92,
      transparent: ghost,
      opacity: ghost ? 0.3 : 1,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: opts.rims === 'turbine' ? 0xd7c48a : opts.rims === 'mesh' ? 0x2a2c33 : 0xc4c8d0,
      metalness: 0.92,
      roughness: 0.22,
      transparent: ghost,
      opacity: ghost ? 0.3 : 1,
    });
    const tire = tireGeometry(R, cfg.wheels.width);
    for (let i = 0; i < 4; i++) {
      const left = i % 2 === 0;
      const wg = new THREE.Group();
      const spinner = new THREE.Group();
      const t = new THREE.Mesh(tire, tireMat);
      t.castShadow = !ghost;
      const rim = rimGroup(R, cfg.wheels.width, opts.rims ?? 'five', rimMat, dark);
      // Лицевая сторона диска — наружу
      if (left) rim.rotation.y = Math.PI;
      spinner.add(t, rim);
      spinner.name = 'spin';
      wg.add(spinner);
      this.wheels.push(wg);
      this.root.add(wg);
    }

    // Модель из Блендера вместо процедурной: из конфига (`model`) или `?carModel=<id>` для проверки
    const modelId = carModelParam() ?? cfg.model;
    if (modelId && !ghost) {
      const want = opts.kit ?? carKitParam();
      const kit = want && cfg.kits?.includes(want) ? want : null;
      this.ready = Promise.all([
        loadCarModel(modelId),
        // Кит не загрузился — машина остаётся на стоковых деталях
        kit
          ? loadCarKit(modelId, kit).catch((e: unknown) => {
              console.warn(`кит ${kit} не загрузился`, e);
              return null;
            })
          : null,
      ])
        .then(([m, k]) => this.useModel(m, k, kit))
        .catch((e: unknown) => console.warn(`модель ${modelId} не загрузилась`, e));
    } else {
      // Процедурный кузов: неподвижные детали — по мешу на материал (бюджет draw calls 10.5)
      mergeStatic(this.body, new Set(this.nitroFlames));
      for (const wg of this.wheels) {
        const spin = wg.getObjectByName('spin');
        if (spin) mergeStatic(spin);
      }
    }
  }

  /** Заменить процедурный кузов и колёса на glTF-модель (ART_BRIEF: узлы body…wheel_RR) + кит. */
  useModel(scene: THREE.Object3D, kitScene?: THREE.Object3D | null, kit?: string | null): void {
    const parts = splitCarModel(scene, kitScene, kit, (root) =>
      applyModelPaint(root, this.opts, this.hi),
    );
    this.kit = parts.kit;
    // Неон и пламя нитро остаются, процедурный кузов прячется
    for (const c of this.body.children)
      if (!this.nitroFlames.includes(c as THREE.Mesh) && c.name !== 'neon') c.visible = false;
    // Начало модели — на земле, центр колёс — на высоте радиуса
    parts.body.position.set(0, this.wheelY - this.cfg.wheels.radius, 0);
    this.body.add(parts.body);
    this.wheels.forEach((wg, i) => {
      const spin = wg.getObjectByName('spin')!;
      for (const c of spin.children) c.visible = false;
      spin.add(parts.wheels[i]!);
      const brake = parts.brakes[i];
      if (brake) wg.add(brake);
    });
    this.modelTail = parts.tailMaterial;
    this.wheelInset = 0;
    // Подъёмные фары: ночь в каждом городе — крышки поднимаются через секунду после появления машины
    this.popups = [];
    for (const n of ['popup_L', 'popup_R']) {
      const lid = parts.body.getObjectByName(n);
      const hinge = parts.body.getObjectByName(`hinge_${n}`);
      if (!lid || !hinge) continue;
      // Ось — петля у задней кромки крышки: крышка переезжает в группу с началом в петле
      const pivot = new THREE.Group();
      pivot.position.copy(hinge.position);
      lid.parent!.add(pivot);
      lid.position.sub(hinge.position);
      pivot.add(lid);
      this.popups.push(pivot);
    }
    this.popupAt = performance.now() / 1000 + 1;
  }

  /** Мигнуть фарами: ярче на `seconds` секунд (через bloom выглядит как вспышка). */
  flash(seconds: number): void {
    this.flashT = performance.now() + seconds * 1000;
    this.headMat?.color.setRGB(6, 6, 6);
    setTimeout(
      () => {
        if (performance.now() >= this.flashT) this.headMat?.color.setHex(0xf4f7ff);
      },
      seconds * 1000 + 20,
    );
  }

  setBraking(on: boolean): void {
    this.brakeMat.color.setHex(on ? 0xff2020 : 0x701010);
    if (this.modelTail) this.modelTail.emissiveIntensity = on ? 3 : 1;
  }

  /** Крышки фар: плавный подъём на петле (ось X) до 62°. */
  private animatePopups(): void {
    if (!this.popups.length || this.popupOpen >= 1) return;
    const now = performance.now() / 1000;
    if (now < this.popupAt) return;
    this.popupOpen = Math.min(1, (now - this.popupAt) / 0.45);
    const e = this.popupOpen * this.popupOpen * (3 - 2 * this.popupOpen);
    for (const p of this.popups) p.rotation.x = e * THREE.MathUtils.degToRad(62);
  }

  setNitro(on: boolean, t: number): void {
    this.animatePopups();
    for (const f of this.nitroFlames) {
      f.visible = on;
      if (on) f.scale.set(1, 0.7 + Math.sin(t * 60) * 0.3, 1);
    }
    // Анимированный неон (премиум)
    if (this.neonMat && this.neonFx === 'rainbow')
      this.neonMat.color.setHSL((t * 0.15) % 1, 1, 0.55);
    else if (this.neonMat && this.neonFx === 'pulse')
      this.neonMat.color
        .copy(this.neonBase)
        .multiplyScalar(0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 4)));
  }

  /** Позиция колёс: локальная точка крепления + длина подвески, поворот руля и вращение. */
  setWheel(
    i: number,
    local: THREE.Vector3,
    suspensionLength: number,
    steer: number,
    spin: number,
    left: boolean,
  ): void {
    const wg = this.wheels[i]!;
    wg.position.set(
      local.x + (left ? this.wheelInset : -this.wheelInset),
      local.y - suspensionLength,
      local.z,
    );
    wg.rotation.set(0, -steer, 0);
    const sp = wg.getObjectByName('spin')!;
    sp.rotation.x = -spin;
  }
}
