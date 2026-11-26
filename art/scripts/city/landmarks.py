"""Ориентиры города (BLENDER_PLAN 6.4) — стилизованные силуэты, не копии реальных зданий.

Москва: высотка со ступенями и шпилем, телебашня-игла, арочный мост над улицей.
Тот же атлас, что у модулей (один материал). Начало — центр основания на земле.
Список и места — art/specs/city/<kit>.json.
"""

import math
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from city import trim_sheet as ts  # noqa: E402
from city.build_modules import block, lathe  # noqa: E402


def spire_tower(m):
    """Ступенчатая высотка: широкое основание, три уступа, башенка и шпиль."""
    top = block(m, 70, 36, 9, 3.4, 'plaster_cream', 3.6, 1.5, 2.1, gh=4.4, cornice=True, pilasters=True, lit=0.55)
    z = top + 0.55
    for w, d, floors in ((40, 30, 8), (26, 22, 7), (16, 16, 6)):
        before = set(m.bm.verts)  # уступ строится на земле и поднимается на высоту предыдущего
        t = block(m, w, d, floors, 3.4, 'plaster_cream', 3.6, 1.4, 2.0, gh=3.4, cornice=True, lit=0.55)
        for v in set(m.bm.verts) - before:
            v.co.z += z
        z += t + 0.55
    # барабан башенки и шпиль
    u0, v0, u1, v1 = ts.window_uv(7)  # тёплая подсветка
    m.box(-5, 5, -5, 5, z, z + 10, 'plaster_cream')
    m.box(-3.5, 3.5, -3.5, 3.5, z + 10, z + 17, 'cornice')
    lathe(m, [(3.0, z + 17), (1.4, z + 26), (0.6, z + 38), (0.08, z + 52)], 10, 0, 0, u0 + 0.01, v0 + 0.02, u1 - 0.01,
          v1 - 0.02)
    return z + 52


def tv_tower(m):
    """Телебашня: коническая опора, ствол, смотровая площадка-диск, игла антенны."""
    pv0, pv1 = ts.strip_v('panel')
    lathe(m, [(14, 0), (9, 12), (5.5, 40), (4.2, 120), (3.6, 220)], 16, 0, 0, 0.0, pv0, 1.0, pv1)
    gv0, gv1 = ts.strip_v('glass')
    lathe(m, [(3.6, 220), (13, 226), (13, 234), (3.6, 240)], 20, 0, 0, 0.0, gv0, 1.0, gv1)
    # кольцо горящих окон смотровой площадки
    u0, v0, u1, v1 = ts.window_uv(15)
    lathe(m, [(13.06, 227), (13.06, 233)], 20, 0, 0, u0, v0, u1, v1)
    lathe(m, [(3.6, 240), (2.4, 290), (1.0, 330), (0.25, 360)], 10, 0, 0, 0.0, pv0, 1.0, pv1)
    return 360.0


def arch_bridge(m):
    """Арочный мост над улицей: пролёт 48 м по X, две арки, опоры за пределами проезжей части."""
    span, deck_z, width = 48.0, 9.0, 14.0
    m.box(-span / 2 - 6, span / 2 + 6, -width / 2, width / 2, deck_z, deck_z + 1.4, 'panel', bottom=True)
    for x in (-span / 2 - 3, span / 2 + 3):  # опоры
        m.box(x - 3, x + 3, -width / 2, width / 2, 0, deck_z, 'plaster_beige')
    # арки над настилом — дуга из коробок
    n = 18
    for side in (-1, 1):
        y = side * (width / 2 - 0.6)
        for k in range(n):
            a0, a1 = math.pi * k / n, math.pi * (k + 1) / n
            x0, x1 = -span / 2 * math.cos(a0), -span / 2 * math.cos(a1)
            z0, z1 = deck_z + 1.4 + 12 * math.sin(a0), deck_z + 1.4 + 12 * math.sin(a1)
            m.box(min(x0, x1) - 0.3, max(x0, x1) + 0.3, y - 0.45, y + 0.45, min(z0, z1), max(z0, z1) + 0.9, 'cornice')
        for k in range(1, 8):  # подвески
            x = -span / 2 + span * k / 8
            zt = deck_z + 1.4 + 12 * math.sin(math.acos(max(-1, min(1, -x / (span / 2)))))
            m.box(x - 0.12, x + 0.12, y - 0.12, y + 0.12, deck_z + 1.4, zt, 'panel', top=False)
    # фонари на ограждении
    u0, v0, u1, v1 = ts.window_uv(6)
    for x in range(-24, 25, 8):
        for side in (-1, 1):
            m.quad([(x - 0.3, side * width / 2 * 1.001, deck_z + 1.4), (x + 0.3, side * width / 2 * 1.001, deck_z + 1.4),
                    (x + 0.3, side * width / 2 * 1.001, deck_z + 2.2), (x - 0.3, side * width / 2 * 1.001, deck_z + 2.2)
                    ][::side], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)][::side])
    return deck_z + 14.3


LANDMARKS = [
    # id, генератор, размер основания (x, y), тип размещения
    ('spire_tower', spire_tower, (78, 44), 'plot'),
    ('tv_tower', tv_tower, (30, 30), 'plot'),
    ('arch_bridge', arch_bridge, (60, 14), 'span'),
]


# ---------------- «Токио-неон» ----------------

def lattice_tower(m):
    """Решётчатая башня-силуэт: четыре сходящиеся опоры, пояса подсветки, две площадки, игла."""
    pv0, pv1 = ts.strip_v('panel')
    H = 300.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            for k in range(12):  # опора из отрезков, сходящихся к оси
                z0, z1 = H * 0.75 * k / 12, H * 0.75 * (k + 1) / 12
                r0, r1 = 40 * (1 - z0 / (H * 0.8)) ** 1.6 + 3, 40 * (1 - z1 / (H * 0.8)) ** 1.6 + 3
                cx, cy = sx * (r0 + r1) / 2, sy * (r0 + r1) / 2
                m.box(cx - 1.4, cx + 1.4, cy - 1.4, cy + 1.4, z0, z1 + 0.5, 'cornice' if k % 2 else 'panel')
    for z, cell in ((60, 4), (120, 7), (170, 4)):  # светящиеся пояса
        r = 40 * (1 - z / (H * 0.8)) ** 1.6 + 4.5
        u0, v0, u1, v1 = ts.window_uv(cell)
        lathe(m, [(r, z), (r, z + 3)], 4, 0, 0, u0, v0, u1, v1)
    gv0, gv1 = ts.strip_v('glass')
    lathe(m, [(14, 150), (16, 152), (16, 160), (12, 162)], 12, 0, 0, 0.0, gv0, 1.0, gv1)  # площадка
    lathe(m, [(7, 220), (8, 222), (8, 228), (5, 230)], 10, 0, 0, 0.0, gv0, 1.0, gv1)
    lathe(m, [(3.5, 225), (1.2, 270), (0.2, H)], 8, 0, 0, 0.0, pv0, 1.0, pv1)
    return H


def screen_corner(m):
    """Угол с экранами над большим перекрёстком: башня с тремя медиаэкранами."""
    top = block(m, 34, 30, 9, 3.6, 'plaster_cream', 3.0, 2.0, 1.8, gh=5.0, lit=0.6)
    for (x0, x1, y), cell in (((-15, 3, -15.3), 11), ((4, 16, -15.3), 12)):
        u0, v0, u1, v1 = ts.window_uv(cell)
        m.quad([(x0, y, 8), (x1, y, 8), (x1, y, top - 3), (x0, y, top - 3)][::-1],
               [(u0, v0), (u1, v0), (u1, v1), (u0, v1)][::-1])
    u0, v0, u1, v1 = ts.window_uv(10)
    m.quad([(17.3, -12, 10), (17.3, 10, 10), (17.3, 10, 24), (17.3, -12, 24)],
           [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    return top


def pylon_bridge(m):
    """Высокий мост: два пилона с вантами над улицей, огни на пилонах."""
    span, deck_z, width = 56.0, 10.0, 16.0
    m.box(-span / 2 - 6, span / 2 + 6, -width / 2, width / 2, deck_z, deck_z + 1.4, 'panel', bottom=True)
    for x in (-span / 2 - 2, span / 2 + 2):
        for y in (-width / 2 + 0.8, width / 2 - 0.8):
            m.box(x - 1.2, x + 1.2, y - 1.0, y + 1.0, 0, 40, 'cornice')
        m.box(x - 1.0, x + 1.0, -width / 2, width / 2, 36, 38, 'cornice', bottom=True)
        u0, v0, u1, v1 = ts.window_uv(12)
        lathe(m, [(1.3, 32), (1.3, 34)], 6, x, 0, u0, v0, u1, v1)
        for k in range(1, 6):  # ванты
            for sgn in (-1, 1):
                xe = x + sgn * k * 4.5
                if abs(xe) > span / 2 + 6:
                    continue
                for y in (-width / 2 + 0.8, width / 2 - 0.8):
                    zt = 38 - k * 4.2
                    m.box(min(x, xe) - 0.08, max(x, xe) + 0.08, y - 0.08, y + 0.08, deck_z + 1.4, zt, 'panel', top=False)
    return 40.0


KITS = {
    'moscow': LANDMARKS,
    'tokyo': [
        ('lattice_tower', lattice_tower, (90, 90), 'plot'),
        ('screen_corner', screen_corner, (36, 32), 'plot'),
        ('pylon_bridge', pylon_bridge, (68, 16), 'span'),
    ],
}
