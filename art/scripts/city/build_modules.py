"""Модули зданий города (BLENDER_PLAN 6.2) — параметрические генераторы, один атлас на набор.

Запуск: pnpm art:city moscow  →  art/export/city/moscow/modules.glb + modules.json
Модуль: начало — на земле в центре участка, X — фасад вдоль улицы (ширина), Y — глубина, Z — вверх.
Один материал на модуль (атлас + карта свечения окон) — в клиенте один draw call на тип здания.
LOD1 — коробка: этажи-полосы из ряда окон атласа (ночью город светится и издалека).
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402

from city import trim_sheet as ts  # noqa: E402
from lib import export, scene  # noqa: E402

DARK_CELLS = [0, 1, 2, 3, 13]
LIT_CELLS = sorted(ts.LIT - {15})
WINDOW_LIT = LIT_CELLS  # горящие окна квартир; в «Токио» без неоновых ячеек (они — вывески)


class Mesh:
    """bmesh с одним слоем UV и удобными примитивами."""

    def __init__(self, seed):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('uv0')
        self.rng = np.random.default_rng(seed)

    def quad(self, pts, uvs):
        vs = [self.bm.verts.new(p) for p in pts]
        f = self.bm.faces.new(vs)
        for loop, uv in zip(f.loops, uvs):
            loop[self.uv].uv = uv
        return f

    def wall(self, a, b, z0, z1, strip, u0=0.0):
        """Стена от a к b (x, y) — наружу слева при обходе против часовой (вид сверху)."""
        v0, v1 = ts.strip_v(strip) if strip in ts.STRIPS else ts.misc_v(strip)
        ln = math.dist(a, b)
        ua, ub = u0, u0 + ln / ts.METERS
        self.quad([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)],
                  [(ua, v0), (ub, v0), (ub, v1), (ua, v1)])

    def window(self, a, b, t, z0, w, h, cell, out=0.03):
        """Окно на стене a→b: центр на доле t длины, низ на z0; чуть впереди стены."""
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy)
        ux, uy = dx / ln, dy / ln
        nx, ny = uy, -ux  # наружная нормаль (обход против часовой)
        cx, cy = a[0] + dx * t + nx * out, a[1] + dy * t + ny * out
        p0 = (cx - ux * w / 2, cy - uy * w / 2)
        p1 = (cx + ux * w / 2, cy + uy * w / 2)
        u0, v0, u1, v1 = ts.window_uv(cell)
        e = 0.004  # без просачивания соседней ячейки
        self.quad([(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z0 + h), (p0[0], p0[1], z0 + h)],
                  [(u0 + e, v0 + e), (u1 - e, v0 + e), (u1 - e, v1 - e), (u0 + e, v1 - e)])

    def box(self, x0, x1, y0, y1, z0, z1, strip, top=True, bottom=False):
        """Коробка: стены полосой strip, крышка — бетон."""
        ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        for i in range(4):
            self.wall(ring[i], ring[(i + 1) % 4], z0, z1, strip)
        pv0, pv1 = ts.strip_v('panel')
        if top:
            self.quad([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
                      [(0, pv0), (0.3, pv0), (0.3, pv1), (0, pv1)])
        if bottom:
            self.quad([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)],
                      [(0, pv0), (0.3, pv0), (0.3, pv1), (0, pv1)])

    def cell(self, lit_share):
        return int(self.rng.choice(WINDOW_LIT)) if self.rng.random() < lit_share else int(self.rng.choice(DARK_CELLS))

    def finish(self):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        return self.bm


def ring_of(w, d):
    hw, hd = w / 2, d / 2
    return [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]


def block(m, w, d, floors, fh, strip, bay, win_w, win_h, ground='shop', gh=None, lit=0.45,
          cornice=False, pilasters=False, loggias=False, sill=0.9, windows=True):
    """Прямоугольный дом: этажи, окна по пролётам, первый этаж-витрина, карниз, пилястры, лоджии."""
    gh = gh or fh
    ring = ring_of(w, d)
    top = gh + fh * (floors - 1)
    for i in range(4):
        a, b = ring[i], ring[(i + 1) % 4]
        ln = math.dist(a, b)
        n = max(1, int(ln / bay))
        front = i in (0, 2)  # длинные фасады: X
        # первый этаж
        if ground == 'shop' and front:
            m.wall(a, b, 0, gh * 0.18, strip)
            m.wall(a, b, gh * 0.18, gh * 0.82, 'shop')
            m.wall(a, b, gh * 0.82, gh, strip)
        else:
            m.wall(a, b, 0, gh, strip)
            for k in range(n if windows else 0):
                m.window(a, b, (k + 0.5) / n, sill, win_w, win_h * 0.9, m.cell(lit * 0.6))
        for f in range(1, floors):
            z0 = gh + fh * (f - 1)
            m.wall(a, b, z0, z0 + fh, strip)
            for k in range(n if windows else 0):
                t = (k + 0.5) / n
                if loggias and front and k % 2 == 0:
                    lg(m, a, b, t, z0, bay * 0.9, fh, m.cell(lit))
                else:
                    m.window(a, b, t, z0 + sill, win_w, win_h, m.cell(lit))
        if pilasters and front:
            dx, dy = (b[0] - a[0]) / ln, (b[1] - a[1]) / ln
            nx, ny = dy, -dx
            for k in range(0, n + 1, 2):
                px, py = a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n
                c = (px + nx * 0.18, py + ny * 0.18)
                m.box(c[0] - 0.3, c[0] + 0.3, c[1] - 0.18, c[1] + 0.18, gh, top - 0.2, 'cornice', top=False)
    # крыша и карниз
    pv0, pv1 = ts.strip_v('panel')
    hw, hd = w / 2, d / 2
    m.quad([(-hw, -hd, top), (hw, -hd, top), (hw, hd, top), (-hw, hd, top)],
           [(0, pv0), (w / ts.METERS, pv0), (w / ts.METERS, pv1), (0, pv1)])
    if cornice:
        m.box(-hw - 0.45, hw + 0.45, -hd - 0.45, hd + 0.45, top - 0.2, top + 0.55, 'cornice', bottom=True)
    return top


def lg(m, a, b, t, z0, lw, fh, cell):
    """Лоджия: выступ 1 м с экраном ограждения, окно в глубине."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    ux, uy = dx / ln, dy / ln
    nx, ny = uy, -ux
    cx, cy = a[0] + dx * t, a[1] + dy * t
    p0 = (cx - ux * lw / 2, cy - uy * lw / 2)
    p1 = (cx + ux * lw / 2, cy + uy * lw / 2)
    q0 = (p0[0] + nx * 1.0, p0[1] + ny * 1.0)
    q1 = (p1[0] + nx * 1.0, p1[1] + ny * 1.0)
    m.wall(q0, q1, z0, z0 + 1.1, 'railing')  # экран
    m.wall(p0, q0, z0, z0 + 1.1, 'railing')
    m.wall(q1, p1, z0, z0 + 1.1, 'railing')
    pv0, pv1 = ts.strip_v('panel')
    m.quad([(p0[0], p0[1], z0 + fh - 0.12), (p1[0], p1[1], z0 + fh - 0.12), (q1[0], q1[1], z0 + fh - 0.12),
            (q0[0], q0[1], z0 + fh - 0.12)][::-1], [(0, pv0), (0.1, pv0), (0.1, pv1), (0, pv1)])
    m.window(a, b, t, z0 + 0.3, lw * 0.75, fh * 0.7, cell, out=0.02)


def lathe(m, profile, seg, cx, cy, u0, v0, u1, v1):
    """Тело вращения (купол) с UV в прямоугольнике атласа."""
    rings = []
    for r, z in profile:
        rings.append([m.bm.verts.new((cx + r * math.cos(2 * math.pi * k / seg),
                                      cy + r * math.sin(2 * math.pi * k / seg), z)) for k in range(seg)])
    for i in range(len(rings) - 1):
        for k in range(seg):
            k2 = (k + 1) % seg
            f = m.bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
            for loop, (a, b) in zip(f.loops, ((k, i), (k + 1, i), (k + 1, i + 1), (k, i + 1))):
                loop[m.uv].uv = (u0 + (u1 - u0) * a / seg, v0 + (v1 - v0) * b / (len(rings) - 1))


# ---------------- типы ----------------

def stalinka(m, w, d, floors, strip):
    return block(m, w, d, floors, 3.4, strip, 3.6, 1.5, 2.1, gh=4.4, cornice=True, pilasters=True, lit=0.5)


def panel(m, w, d, floors):
    return block(m, w, d, floors, 2.8, 'panel', 3.0, 1.5, 1.5, ground='wall', gh=2.8, loggias=True, lit=0.42)


def khrush(m, w, d, strip):
    return block(m, w, d, 5, 2.7, strip, 3.0, 1.4, 1.5, ground='wall', gh=2.7, lit=0.4)


def tower(m, w, d, floors):
    top = block(m, w, d, floors, 3.8, 'glass', 3.0, 2.9, 3.0, gh=5.0, lit=0.0, windows=False)
    # горящие офисы: отдельные «окна» поверх стекла на случайных этажах
    ring = ring_of(w, d)
    for f in range(1, floors):
        if m.rng.random() > 0.55:
            continue
        for i in range(4):
            a, b = ring[i], ring[(i + 1) % 4]
            n = int(math.dist(a, b) / 3.0)
            k0 = int(m.rng.integers(0, max(1, n - 3)))
            for k in range(k0, min(n, k0 + int(m.rng.integers(1, 4)))):
                m.window(a, b, (k + 0.5) / n, 5.0 + 3.8 * (f - 1) + 0.4, 2.9, 3.0, 15, out=0.04)
    m.box(-w * 0.3, w * 0.3, -d * 0.3, d * 0.3, top, top + 6, 'glass')  # венец
    return top + 6


def mall(m, w, d, floors):
    top = block(m, w, d, floors, 4.5, 'panel', 6.0, 4.5, 2.4, gh=5.5, lit=0.7)
    # вывески вымышленных магазинов — светящиеся витринные панели над входом
    for x in (-w * 0.3, 0.0, w * 0.3):
        m.box(x - 3, x + 3, -d / 2 - 0.4, -d / 2 - 0.1, 4.6, 5.4, 'shop')
    return top


def gas(m, w, d):
    hw, hd = w / 2, d / 2
    m.box(-hw, hw, -hd, hd, 5.2, 6.0, 'cornice', bottom=True)  # навес
    for x in (-hw * 0.6, hw * 0.6):
        for y in (-hd * 0.5, hd * 0.5):
            m.box(x - 0.2, x + 0.2, y - 0.2, y + 0.2, 0, 5.2, 'panel', top=False)
    # колонки
    for x in (-hw * 0.6, hw * 0.6):
        m.box(x - 0.4, x + 0.4, -0.3, 0.3, 0, 1.8, 'shop')
    # павильон за навесом
    m.box(-4, 4, hd + 0.5, hd + 6.5, 0, 3.6, 'shop')
    return 6.0


def pavilion(m, w, d):
    hw, hd = w / 2, d / 2
    m.box(-hw, hw, -hd, hd, 0, 2.9, 'shop')
    m.box(-hw - 0.3, hw + 0.3, -hd - 0.3, hd + 0.3, 2.9, 3.3, 'cornice', bottom=True)
    return 3.3


def church(m, w, d):
    """Стилизованный храм-силуэт: объём, барабан и луковичный купол (не копия конкретного храма)."""
    block(m, w, d, 2, 4.5, 'plaster_cream', 3.0, 1.0, 2.6, ground='wall', gh=4.5, lit=0.6)
    m.box(-3.5, 3.5, -3.5, 3.5, 9.0, 14.0, 'plaster_cream')  # барабан
    u0, v0, u1, v1 = ts.window_uv(5)  # тёплая ячейка — подсвеченный купол
    prof = [(3.3, 14.0), (3.9, 15.2), (4.1, 16.6), (3.6, 18.0), (2.5, 19.2), (1.1, 20.2), (0.25, 21.2), (0.05, 23.0)]
    lathe(m, prof, 16, 0, 0, u0 + 0.01, v0 + 0.02, u1 - 0.01, v1 - 0.02)
    return 23.0


# ---------------- реквизит (6.3): тот же атлас, ставится вдоль улиц ----------------
# Начало — на кромке тротуара; X — вдоль улицы, −Y — к проезжей части.

def prop_bus_stop(m):
    m.box(-4.0, 4.0, 0.2, 1.8, 2.6, 2.8, 'cornice', bottom=True)  # крыша
    m.box(-4.0, 4.0, 1.7, 1.8, 0.0, 2.6, 'glass', top=False)  # задняя стенка
    m.box(-4.0, -3.9, 0.3, 1.8, 0.0, 2.6, 'glass', top=False)
    m.box(2.2, 3.9, 1.5, 1.7, 0.2, 2.4, 'shop')  # световой короб с афишей
    m.box(-3.0, 1.5, 1.2, 1.6, 0.45, 0.55, 'panel')  # скамья
    return 2.8


def prop_barrier(m):
    for x in range(-6, 7, 3):
        m.box(x - 0.06, x + 0.06, -0.06, 0.06, 0, 0.75, 'panel', top=True)
    m.box(-6.2, 6.2, -0.03, 0.03, 0.45, 0.75, 'railing')
    return 0.75


def prop_billboard(m):
    m.box(-0.25, 0.25, -0.25, 0.25, 0, 6.0, 'panel')
    m.box(-4.5, 4.5, -0.3, 0.3, 6.0, 9.2, 'cornice', bottom=True)
    # световые панели с обеих сторон (вымышленные бренды рисует клиент поверх, как вывески)
    v0, v1 = ts.misc_v('shop')
    for side in (-1, 1):
        y = side * 0.31
        pts = [(-4.3, y, 6.2), (4.3, y, 6.2), (4.3, y, 9.0), (-4.3, y, 9.0)]
        m.quad(pts if side < 0 else pts[::-1], [(0, v0), (0.7, v0), (0.7, v1), (0, v1)][::(1 if side < 0 else -1)])
    return 9.2


def prop_traffic_light(m):
    m.box(-0.1, 0.1, -0.1, 0.1, 0, 5.6, 'panel')
    m.box(-0.1, 0.1, -3.0, 0.1, 5.4, 5.6, 'panel')  # консоль над дорогой
    m.box(-0.25, 0.25, -3.0, -2.6, 4.3, 5.4, 'panel')
    u0, v0, u1, v1 = ts.window_uv(4)  # тёплый (жёлто-красный) сигнал
    m.quad([(-0.18, -3.01, 4.45), (0.18, -3.01, 4.45), (0.18, -3.01, 5.25), (-0.18, -3.01, 5.25)][::-1],
           [(u0, v0), (u1, v0), (u1, v1), (u0, v1)][::-1])
    return 5.6


def prop_snowbank(m):
    for x, w, h in ((-3.5, 2.6, 0.7), (-0.6, 3.2, 0.9), (2.6, 2.4, 0.6)):
        prof = [(w / 2, 0.0), (w / 2 * 0.8, h * 0.5), (w / 2 * 0.45, h * 0.9), (0.05, h)]
        v0, v1 = ts.misc_v('cornice')
        lathe(m, prof, 8, x, 0.5, 0.0, v0, 0.3, v1)
    return 0.9


MODULES_MOSCOW = [
    # id, тип, ширина, глубина, генератор
    ('stalinka_a', 'stalinka', 36, 16, lambda m: stalinka(m, 36, 16, 7, 'plaster_beige')),
    ('stalinka_b', 'stalinka', 48, 16, lambda m: stalinka(m, 48, 16, 8, 'plaster_cream')),
    ('stalinka_c', 'stalinka', 60, 18, lambda m: stalinka(m, 60, 18, 9, 'plaster_beige')),
    ('stalinka_d', 'stalinka', 24, 16, lambda m: stalinka(m, 24, 16, 7, 'brick_red')),
    ('panel9_a', 'panel9', 36, 12, lambda m: panel(m, 36, 12, 9)),
    ('panel9_b', 'panel9', 60, 12, lambda m: panel(m, 60, 12, 9)),
    ('panel16_a', 'panel16', 36, 13, lambda m: panel(m, 36, 13, 16)),
    ('panel16_b', 'panel16', 48, 13, lambda m: panel(m, 48, 13, 16)),
    ('khrush_a', 'khrush', 40, 12, lambda m: khrush(m, 40, 12, 'brick_sand')),
    ('khrush_b', 'khrush', 60, 12, lambda m: khrush(m, 60, 12, 'panel')),
    ('khrush_c', 'khrush', 48, 12, lambda m: khrush(m, 48, 12, 'brick_red')),
    ('tower_a', 'tower', 30, 30, lambda m: tower(m, 30, 30, 22)),
    ('tower_b', 'tower', 36, 28, lambda m: tower(m, 36, 28, 30)),
    ('tower_c', 'tower', 28, 28, lambda m: tower(m, 28, 28, 40)),
    ('mall_a', 'mall', 60, 40, lambda m: mall(m, 60, 40, 3)),
    ('mall_b', 'mall', 40, 30, lambda m: mall(m, 40, 30, 2)),
    ('gas_a', 'gas', 24, 16, lambda m: gas(m, 24, 16)),
    ('pavilion_a', 'pavilion', 6, 4, lambda m: pavilion(m, 6, 4)),
    ('pavilion_b', 'pavilion', 10, 5, lambda m: pavilion(m, 10, 5)),
    ('church_a', 'church', 16, 24, lambda m: church(m, 16, 24)),
    ('prop_bus_stop', 'prop_bus_stop', 8, 2, prop_bus_stop),
    ('prop_barrier', 'prop_barrier', 12, 0.2, prop_barrier),
    ('prop_billboard', 'prop_billboard', 9, 0.6, prop_billboard),
    ('prop_traffic_light', 'prop_traffic_light', 0.5, 3, prop_traffic_light),
    ('prop_snowbank', 'prop_snowbank', 9, 3, prop_snowbank),
]


# ---------------- набор «Токио-неон» (B6) ----------------

def sign(m, x0, x1, y0, y1, z0, z1, cell):
    """Световой короб-вывеска: все боковые грани — ячейка неона атласа."""
    u0, v0, u1, v1 = ts.window_uv(cell)
    ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for i in range(4):
        a, b = ring[i], ring[(i + 1) % 4]
        m.quad([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)],
               [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])


NEON_CELLS = (10, 11, 12)


def narrow(m, w, d, floors, strip):
    """Узкий высокий дом с вертикальной неоновой вывеской и поперечными табличками."""
    top = block(m, w, d, floors, 3.1, strip, 2.6, 1.7, 1.6, gh=3.8, lit=0.62)
    c = int(m.rng.choice(NEON_CELLS))
    x = w / 2 - 0.7
    sign(m, x - 0.45, x + 0.45, -d / 2 - 1.0, -d / 2 - 0.7, 4.2, top - 1.0, c)
    for f in range(2, floors, 3):  # поперечные таблички этажей
        z = 3.8 + 3.1 * (f - 1)
        sign(m, -w / 2 + 0.5, -w / 2 + 2.8, -d / 2 - 0.5, -d / 2 - 0.15, z + 0.4, z + 1.3,
             int(m.rng.choice(NEON_CELLS)))
    return top


def stair_house(m, w, d, floors):
    """Дом с наружной лестницей-галереей и блоками кондиционеров на фасаде."""
    fh = 2.9
    top = block(m, w, d, floors, fh, 'plaster_beige', 3.2, 1.5, 1.4, ground='wall', gh=fh, lit=0.5)
    for f in range(floors):  # площадки и марши у торца
        z = fh * f
        m.box(w / 2, w / 2 + 1.4, -1.6, 1.6, z + fh - 0.2, z + fh, 'panel', bottom=True)
        m.wall((w / 2 + 1.4, -1.6), (w / 2 + 1.4, 1.6), z + fh, z + fh + 1.0, 'railing')
    for f in range(1, floors):  # кондиционеры под окнами
        for k in range(int(w / 3.2)):
            if m.rng.random() < 0.55:
                x = -w / 2 + 3.2 * (k + 0.5) + 1.1
                m.box(x - 0.4, x + 0.4, -d / 2 - 0.35, -d / 2 - 0.02, fh * f + 0.1, fh * f + 0.7, 'panel')
    return top


def media_mall(m, w, d, floors):
    """ТЦ с медиафасадом: огромный светящийся экран на углу."""
    top = mall(m, w, d, floors)
    u0, v0, u1, v1 = ts.window_uv(int(m.rng.choice(NEON_CELLS)))
    x0, x1, y = w / 2 - 22, w / 2 - 2, -d / 2 - 0.2
    m.quad([(x0, y, 7), (x1, y, 7), (x1, y, top - 1.5), (x0, y, top - 1.5)][::-1],
           [(u0, v0), (u1, v0), (u1, v1), (u0, v1)][::-1])
    return top


def konbini(m, w, d):
    hw, hd = w / 2, d / 2
    m.box(-hw, hw, -hd, hd, 0, 4.0, 'shop')
    sign(m, -hw, hw, -hd - 0.25, -hd + 0.01, 3.3, 4.0, 12)  # полоса-вывеска
    return 4.0


def cafe(m, w, d):
    top = block(m, w, d, 2, 3.2, 'brick_red', 2.6, 1.8, 1.6, gh=3.4, lit=0.8)
    m.box(-w / 2, w / 2, -d / 2 - 1.4, -d / 2, 2.9, 3.1, 'cornice', bottom=True)  # навес
    return top


def gate(m, w, d):
    """Храмовые ворота-силуэт (стилизация): два столба и две балки, без копирования конкретных ворот."""
    for x in (-w / 2 + 1, w / 2 - 1):
        m.box(x - 0.45, x + 0.45, -0.45, 0.45, 0, 8.0, 'brick_red')
    m.box(-w / 2 - 1.2, w / 2 + 1.2, -0.6, 0.6, 8.0, 8.9, 'brick_red', bottom=True)
    m.box(-w / 2 + 0.3, w / 2 - 0.3, -0.35, 0.35, 6.6, 7.1, 'brick_red', bottom=True)
    return 8.9


def prop_vending(m):
    for x in (-0.55, 0.55):
        m.box(x - 0.5, x + 0.5, 0.0, 0.8, 0, 1.85, 'panel')
        u0, v0, u1, v1 = ts.window_uv(15)
        m.quad([(x - 0.42, -0.01, 0.25), (x + 0.42, -0.01, 0.25), (x + 0.42, -0.01, 1.75), (x - 0.42, -0.01, 1.75)][::-1],
               [(u0, v0), (u1, v0), (u1, v1), (u0, v1)][::-1])
    return 1.85


def prop_lantern(m):
    m.box(-0.06, 0.06, 0.4, 0.52, 0, 3.0, 'panel')
    u0, v0, u1, v1 = ts.window_uv(7)
    lathe(m, [(0.05, 2.0), (0.32, 2.15), (0.36, 2.45), (0.3, 2.75), (0.05, 2.85)], 10, 0, 0.2, u0, v0, u1, v1)
    return 3.0


MODULES_TOKYO = [
    ('narrow_a', 'stalinka', 9, 12, lambda m: narrow(m, 9, 12, 6, 'plaster_beige')),
    ('narrow_b', 'stalinka', 8, 12, lambda m: narrow(m, 8, 12, 9, 'plaster_cream')),
    ('narrow_c', 'panel16', 10, 13, lambda m: narrow(m, 10, 13, 12, 'brick_sand')),
    ('narrow_d', 'panel9', 12, 12, lambda m: narrow(m, 12, 12, 8, 'brick_red')),
    ('stair_a', 'khrush', 20, 10, lambda m: stair_house(m, 20, 10, 5)),
    ('stair_b', 'panel9', 24, 11, lambda m: stair_house(m, 24, 11, 7)),
    ('office_a', 'tower', 25, 25, lambda m: tower(m, 25, 25, 16)),
    ('office_b', 'tower', 30, 26, lambda m: tower(m, 30, 26, 26)),
    ('office_c', 'panel16', 24, 20, lambda m: tower(m, 24, 20, 11)),
    ('mall_t', 'mall', 50, 35, lambda m: media_mall(m, 50, 35, 4)),
    ('konbini_a', 'pavilion', 12, 10, lambda m: konbini(m, 12, 10)),
    ('cafe_a', 'gas', 8, 8, lambda m: cafe(m, 8, 8)),
    ('gate_a', 'church', 10, 2, lambda m: gate(m, 10, 2)),
    ('prop_vending', 'prop_bus_stop', 2.2, 0.8, prop_vending),
    ('prop_lantern', 'prop_snowbank', 0.8, 0.8, prop_lantern),
    ('prop_barrier', 'prop_barrier', 12, 0.2, prop_barrier),
    ('prop_billboard', 'prop_billboard', 9, 0.6, prop_billboard),
    ('prop_traffic_light', 'prop_traffic_light', 0.5, 3, prop_traffic_light),
]


def lod1(m, w, d, h, seed):
    """Коробка: каждый этаж (3 м) — полоса окон атласа со сдвигом, крыша — бетон."""
    ring = ring_of(w, d)
    wv0, wv1 = ts.strip_v('windows')
    rng = np.random.default_rng(seed)
    floors = max(1, int(h / 3.0))
    fh = h / floors
    for i in range(4):
        a, b = ring[i], ring[(i + 1) % 4]
        ln = math.dist(a, b)
        for f in range(floors):
            u0 = float(rng.random())
            uw = ln / 3.0 / ts.N_WIN  # ячейка окна на 3 м фасада
            m.quad([(a[0], a[1], f * fh), (b[0], b[1], f * fh), (b[0], b[1], (f + 1) * fh), (a[0], a[1], (f + 1) * fh)],
                   [(u0, wv0), (u0 + uw, wv0), (u0 + uw, wv1), (u0, wv1)])
    pv0, pv1 = ts.strip_v('panel')
    hw, hd = w / 2, d / 2
    m.quad([(-hw, -hd, h), (hw, -hd, h), (hw, hd, h), (-hw, hd, h)], [(0, pv0), (0.3, pv0), (0.3, pv1), (0, pv1)])


def material(kit, out):
    m = bpy.data.materials.new(f'city_{kit}')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(os.path.join(out, 'atlas.jpg'))
    emi = nt.nodes.new('ShaderNodeTexImage')
    emi.image = bpy.data.images.load(os.path.join(out, 'atlas_emit.jpg'))
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(emi.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 1.0
    b.inputs['Roughness'].default_value = 0.85
    return m


KITS = {'moscow': MODULES_MOSCOW, 'tokyo': MODULES_TOKYO}
MODULES = MODULES_MOSCOW  # совместимость: набор по умолчанию


def kit_arg():
    return sys.argv[sys.argv.index('--kit') + 1] if '--kit' in sys.argv else 'moscow'


def main(kit=None):
    global WINDOW_LIT
    kit = kit or kit_arg()
    WINDOW_LIT = [c for c in LIT_CELLS if not (kit == 'tokyo' and c in ts.NEON)]
    out = os.path.join(scene.ART, 'export', 'city', kit)
    a, e = ts.build(kit=kit)
    ts.save(a, os.path.join(out, 'atlas.jpg'), 2048)
    ts.save(e, os.path.join(out, 'atlas_emit.jpg'), 1024)
    scene.reset()
    mat = material(kit, out)
    root = scene.empty('modules_root')
    cat = []
    for i, (mid, typ, w, d, gen) in enumerate(KITS[kit]):
        m = Mesh(1000 + i)
        h = gen(m)
        o = scene.mesh_object(mid, m.finish(), root, [mat])
        m1 = Mesh(2000 + i)
        if typ.startswith('prop_'):
            gen(m1)  # реквизит лёгкий: LOD1 = LOD0
        else:
            lod1(m1, w, d, h, 3000 + i)
        o1 = scene.mesh_object(f'{mid}_LOD1', m1.finish(), root, [mat])
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        cat.append({'id': mid, 'type': typ, 'w': w, 'd': d, 'h': round(h, 2), 'tris': tris,
                    'trisLod1': sum(len(p.vertices) - 2 for p in o1.data.polygons)})
        print(f'MODULE {mid}: {w}×{d}×{h:.1f} м, {tris} тр.')
    export.glb(root, os.path.join(out, 'modules.glb'))
    # Ориентиры (6.4): отдельный glb того же атласа, места — art/specs/city/<kit>.json
    from city import landmarks
    lroot = scene.empty('landmarks_root')
    lcat = []
    for i, (lid, gen, (w, d), place) in enumerate(landmarks.KITS[kit]):
        m = Mesh(5000 + i)
        h = gen(m)
        o = scene.mesh_object(lid, m.finish(), lroot, [mat])
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        lcat.append({'id': lid, 'w': w, 'd': d, 'h': round(h, 1), 'place': place, 'tris': tris})
        print(f'LANDMARK {lid}: {w}×{d}×{h:.0f} м, {tris} тр.')
    # В glb ориентиров — без текстур: клиент берёт материал атласа из modules.glb (иначе атлас грузится дважды)
    bare = bpy.data.materials.new(f'city_{kit}')
    for o in lroot.children:
        o.data.materials[0] = bare
    export.glb(lroot, os.path.join(out, 'landmarks.glb'))
    for o in lroot.children:
        o.data.materials[0] = mat
    bpy.data.materials.remove(bare)
    spec = json.load(open(os.path.join(scene.ART, 'specs', 'city', f'{kit}.json'), encoding='utf-8'))
    with open(os.path.join(out, 'modules.json'), 'w', encoding='utf-8') as f:
        json.dump({'kit': kit, 'atlas': ts.layout(), 'modules': cat, 'landmarks': lcat,
                   'placements': spec['landmarks']}, f, ensure_ascii=False, indent=1)
    scene.save_blend(os.path.join(scene.ART, 'source', 'city', f'{kit}.blend'))
    return root


if __name__ == '__main__':
    main()
