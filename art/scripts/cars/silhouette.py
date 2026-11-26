"""Схема силуэта машины по спецификации (BLENDER_PLAN 5.2, шаг 1): виды спереди, сбоку, сзади, сверху.

Запуск (через `pnpm art:silhouette <id>`):
  blender -b --factory-startup -P art/scripts/cars/silhouette.py -- --spec art/specs/cars/<id>.json

Результат: art/renders/<id>/silhouette.svg и silhouette.png. Рисуется теми же кривыми
(lib/curves.py), из которых потом строится кузов, — схема и модель совпадают.
Компоновка как на чертеже: спереди | сбоку | сзади, под видом сбоку — вид сверху. Нос — влево.
"""

import math
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import bmesh  # noqa: E402
import bpy  # noqa: E402

from lib import materials, scene  # noqa: E402
from lib.curves import CarShape, superellipse  # noqa: E402

COL = {
    'bg': '#eef0f3', 'body': '#3d63c9', 'body2': '#3354b0', 'glass': '#1c2330', 'tire': '#15161a',
    'rim': '#9aa0aa', 'head': '#fff4c0', 'tail': '#e0303a', 'dark': '#23262d', 'line': '#10131a',
    'dim': '#6b7280', 'grid': '#d7dbe1', 'text': '#111318', 'ground': '#9097a3',
}


class Drawing:
    """Плоский рисунок в метрах: полигоны, линии, текст → SVG и сцена Блендера."""

    def __init__(self):
        self.items = []

    def poly(self, pts, fill, stroke=None, width=0.0):
        self.items.append(('poly', [tuple(p) for p in pts], fill, stroke, width))

    def line(self, pts, color, width=0.012, closed=False):
        pts = [tuple(p) for p in pts]
        if closed:
            pts = pts + [pts[0]]
        self.items.append(('line', pts, color, width))

    def circle(self, c, r, fill, stroke=None, width=0.0, steps=64):
        pts = [(c[0] + r * math.cos(2 * math.pi * k / steps), c[1] + r * math.sin(2 * math.pi * k / steps))
               for k in range(steps)]
        self.poly(pts, fill, stroke, width)

    def text(self, pos, s, size=0.12, color='text', align='LEFT'):
        self.items.append(('text', tuple(pos), s, size, color, align))

    def bounds(self):
        xs, ys = [], []
        for it in self.items:
            if it[0] in ('poly', 'line'):
                xs += [p[0] for p in it[1]]
                ys += [p[1] for p in it[1]]
            else:
                xs.append(it[1][0])
                ys.append(it[1][1])
        return min(xs), min(ys), max(xs), max(ys)

    # ---- вывод ----
    def svg(self, path, pad=0.25, px_per_m=240):
        x0, y0, x1, y1 = self.bounds()
        x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
        k = px_per_m
        W, H = (x1 - x0) * k, (y1 - y0) * k

        def P(p):
            return f'{(p[0] - x0) * k:.1f},{(y1 - p[1]) * k:.1f}'

        out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" '
               f'viewBox="0 0 {W:.0f} {H:.0f}" font-family="sans-serif">',
               f'<rect width="100%" height="100%" fill="{COL["bg"]}"/>']
        for it in self.items:
            if it[0] == 'poly':
                _, pts, fill, stroke, w = it
                st = f' stroke="{COL[stroke]}" stroke-width="{w * k:.1f}"' if stroke else ''
                out.append(f'<polygon points="{" ".join(P(p) for p in pts)}" fill="{COL[fill]}"{st}/>')
            elif it[0] == 'line':
                _, pts, c, w = it
                out.append(f'<polyline points="{" ".join(P(p) for p in pts)}" fill="none" '
                           f'stroke="{COL[c]}" stroke-width="{w * k:.1f}" stroke-linejoin="round"/>')
            else:
                _, pos, s, size, c, align = it
                anchor = {'LEFT': 'start', 'CENTER': 'middle', 'RIGHT': 'end'}[align]
                out.append(f'<text x="{(pos[0] - x0) * k:.1f}" y="{(y1 - pos[1]) * k:.1f}" '
                           f'font-size="{size * k:.0f}" fill="{COL[c]}" text-anchor="{anchor}">{s}</text>')
        out.append('</svg>')
        with open(path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(out))

    def blender(self):
        """Каждый элемент — отдельный объект; порядок рисования — высота по Z."""
        mats = {}

        def mat(c):
            if c not in mats:
                m = materials.pbr(f'sil_{c}', COL[c])
                mats[c] = m
            return mats[c]

        for i, it in enumerate(self.items):
            z = i * 0.0005
            if it[0] == 'poly':
                _, pts, fill, stroke, w = it
                bm = bmesh.new()
                vs = [bm.verts.new((x, y, z)) for x, y in _dedupe(pts)]
                if len(vs) >= 3:
                    bm.faces.new(vs)
                scene.mesh_object(f'sil_{i}', bm, materials=[mat(fill)])
                if stroke:
                    self._strip(pts + [pts[0]], w, mat(stroke), z + 0.0002, i)
            elif it[0] == 'line':
                _, pts, c, w = it
                self._strip(pts, w, mat(c), z, i)
            else:
                _, pos, s, size, c, align = it
                cu = bpy.data.curves.new(f'txt_{i}', 'FONT')
                cu.body = s
                cu.size = size
                cu.align_x = align
                o = bpy.data.objects.new(f'txt_{i}', cu)
                o.location = (pos[0], pos[1], z)
                o.data.materials.append(mat(c))
                bpy.context.scene.collection.objects.link(o)

    @staticmethod
    def _strip(pts, w, m, z, i):
        bm = bmesh.new()
        for a, b in zip(pts, pts[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy)
            if ln < 1e-6:
                continue
            nx, ny = -dy / ln * w / 2, dx / ln * w / 2
            # продлеваем на полширины — стыки без щелей
            ex, ey = dx / ln * w / 2, dy / ln * w / 2
            q = [(a[0] - ex + nx, a[1] - ey + ny), (b[0] + ex + nx, b[1] + ey + ny),
                 (b[0] + ex - nx, b[1] + ey - ny), (a[0] - ex - nx, a[1] - ey - ny)]
            bm.faces.new([bm.verts.new((x, y, z)) for x, y in q])
        scene.mesh_object(f'sil_line_{i}', bm, materials=[m])


def _dedupe(pts):
    out = []
    for p in pts:
        if not out or math.dist(p, out[-1]) > 1e-5:
            out.append(p)
    if len(out) > 2 and math.dist(out[0], out[-1]) < 1e-5:
        out.pop()
    return out


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------- виды ----------------

def side_view(d, s, ox, oy):
    """Вид сбоку: нос слева. x = ox + u·L, y = oy + z."""
    L, H = s.L, s.H
    X = lambda u: ox + u * L  # noqa: E731
    N = 240
    us = [k / N for k in range(N + 1)]
    # Земля и сетка 0,5 м
    d.line([(ox - 0.3, oy), (ox + L + 0.3, oy)], 'ground', 0.01)
    # Колёса — под кузовом
    for uc in (s.u_front, s.u_rear):
        d.circle((X(uc), oy + s.R), s.R, 'tire')
        d.circle((X(uc), oy + s.R), s.R * 0.69, 'rim')
        d.circle((X(uc), oy + s.R), s.R * 0.16, 'dark')
    # Кузов: верхняя линия → нижняя с арками
    outline = [(X(u), oy + s.top(u)) for u in us] + [(X(u), oy + s.bottom(u)) for u in reversed(us)]
    d.poly(outline, 'body', 'line', 0.014)
    # Остекление сбоку (боковые окна) с изломом нижней линии у задней стойки
    g = s.gh
    zw = s.window_z()
    ua, uq = g['windshieldBase'] + 0.035, g['roofRear'] + 0.045
    t = g['roofThickness']
    kick = g['quarterKick'] * H
    up = []
    for k in range(41):
        u = lerp(ua, uq, k / 40)
        up.append((X(u), oy + max(s.top(u) - t - 0.012 * (1 - min(1, (u - ua) / 0.06)), zw + 0.02)))
    low = []
    u_k0, u_k1 = g['roofRear'] - 0.03, uq - 0.01
    for k in range(41):
        u = lerp(uq - 0.005, ua, k / 40)
        z = zw
        if u > u_k0:
            z = zw + kick * min(1, (u - u_k0) / (u_k1 - u_k0))
        low.append((X(u), oy + z))
    d.poly(up + low, 'glass')
    # Средняя стойка (B) — по передней кромке задней двери
    ub = g.get('bPillar', 0.6)  # купе: одна длинная дверь до средней стойки
    d.line([(X(ub), oy + zw), (X(ub - 0.006), oy + s.top(ub) - t)], 'body', 0.05)
    # Лобовое и заднее стекло — линии вдоль верха
    d.line([(X(u), oy + s.top(u)) for u in [lerp(g['windshieldBase'], g['roofFront'], k / 12) for k in range(13)]],
           'glass', 0.03)
    d.line([(X(u), oy + s.top(u)) for u in [lerp(g['roofRear'] + 0.02, g['backlightBase'], k / 12) for k in range(13)]],
           'glass', 0.03)
    # Двери, плечевая линия, порог
    zs = s.shoulder_z()
    ud = g.get('doorFront', 0.335)
    d.line([(X(ud), oy + zw), (X(ud), oy + s.bottom(ud) + 0.02)], 'line', 0.008)
    d.line([(X(ub + 0.01), oy + zw + 0.01), (X(ub + 0.018), oy + s.bottom(ub + 0.018) + 0.03)], 'line', 0.008)
    d.line([(X(u), oy + zs + 0.012 * math.sin(u * math.pi)) for u in [lerp(0.03, 0.97, k / 40) for k in range(41)]],
           'body2', 0.02)
    # Нижняя «отбойная» линия двери (door kick)
    d.line([(X(0.36), oy + 0.3), (X(0.58), oy + 0.33), (X(0.64), oy + 0.37)], 'body2', 0.016)
    # Воздухозаборник перед задним колесом
    si = s.spec['sideIntake']
    d.poly([(X(si['u0']), oy + si['h0'] * H), (X(si['u1']), oy + si['h0'] * H + 0.02),
            (X(si['u1'] - 0.008), oy + si['h1'] * H), (X(si['u0'] + 0.012), oy + si['h1'] * H - 0.03)], 'dark')
    # Фары, фонари (срезы сбоку)
    fh = s.spec['face']['headlight']
    hz = fh['h'] * H
    d.poly([(X(0.004), oy + hz - 0.03), (X(0.075), oy + hz + 0.035), (X(0.085), oy + hz + 0.06),
            (X(0.01), oy + hz + 0.03)], 'head', 'line', 0.006)
    th = s.spec['rear']['taillight']
    tz = th['h'] * H
    d.poly([(X(0.995), oy + tz - 0.03), (X(0.96), oy + tz - 0.025), (X(0.96), oy + tz + 0.03),
            (X(0.99), oy + tz + 0.03)], 'tail', 'line', 0.006)
    # Зеркало на ножке
    um = s.spec['mirrors']['u']
    d.line([(X(um), oy + zw + 0.01), (X(um + 0.012), oy + zw + 0.06)], 'dark', 0.015)
    d.poly([(X(um + 0.025) + x, oy + zw + 0.09 + y) for x, y in superellipse(0.08, 0.045, 3, 24)], 'body2',
           'line', 0.006)
    # Спойлер-лезвие на кромке багажника
    sp = s.spec['spoiler']
    u0 = 0.93
    d.poly([(X(u0), oy + s.top(u0)), (X(0.995), oy + s.top(0.995) + sp['height']),
            (X(1.0), oy + s.top(0.995) + sp['height'] - 0.015), (X(0.97), oy + s.top(0.97))], 'dark')
    # Размеры
    y_dim = oy - 0.22
    d.line([(X(0), y_dim), (X(1), y_dim)], 'dim', 0.006)
    d.text(((X(0) + X(1)) / 2, y_dim - 0.16), f'{L:.2f} м', 0.11, 'dim', 'CENTER')
    d.line([(X(s.u_front), oy - 0.06), (X(s.u_rear), oy - 0.06)], 'dim', 0.006)
    d.text(((X(s.u_front) + X(s.u_rear)) / 2, oy - 0.04 + 0.03), f'база {s.wb:.2f}', 0.08, 'dim', 'CENTER')
    d.line([(X(1) + 0.18, oy), (X(1) + 0.18, oy + H)], 'dim', 0.006)
    d.text((X(1) + 0.25, oy + H / 2), f'{H:.2f}', 0.09, 'dim')
    d.text((X(0), oy + H + 0.35), 'Сбоку', 0.14)


def section(s, u, zb, ztop):
    """Поперечное сечение на станции u: нижний кузов (zb..ztop) и кабина над ним.

    Нижний кузов — суперэллипс с наибольшей шириной на высоте плеча; кабина — трапеция
    с завалом боковин (tumblehome) и скруглёнными верхними углами.
    Возвращает (кузов, кабина, стекло, половина ширины) — контуры в координатах (x, z).
    """
    a = s.half_width(u)
    n = s.sec['exponent']
    zs = min(s.shoulder_z(), ztop - 0.05)
    body = []
    for x, y in superellipse(a, zs - zb, n, 24, -math.pi / 2, 0):
        body.append((x, zs + y))
    for x, y in superellipse(a, ztop - zs, n, 24, 0, math.pi / 2)[1:]:
        body.append((x, zs + y))
    body = body + [(-x, z) for x, z in reversed(body)]
    tb = s.sec['tumblehome']
    z0, z1 = s.window_z() - 0.02, s.H
    g0, g1 = a * (1 - tb * 0.45), a * (1 - tb * 1.3)

    def cabin(inset_w, inset_top, zlo):
        right = []
        for k in range(25):
            t = k / 24
            z = lerp(zlo, z1 - inset_top, t)
            corner = (1 - t ** 8) ** (1 / 8)  # плоская крыша, скруглённые углы
            right.append((lerp(g0, g1, t) * corner - inset_w * corner, z))
        return [(x, z) for x, z in right] + [(-x, z) for x, z in reversed(right)]

    return body, cabin(0, 0, z0), cabin(0.07, 0.07, max(z0 + 0.06, ztop + 0.02)), a


def front_view(d, s, ox, oy):
    f = s.spec['face']
    H, W = s.H, s.W
    tr = s.track['front']
    tw = s.spec['dimensions']['tireWidth']
    for sgn in (-1, 1):
        cx = ox + sgn * tr / 2
        d.poly([(cx - tw / 2, oy), (cx + tw / 2, oy), (cx + tw / 2, oy + 2 * s.R), (cx - tw / 2, oy + 2 * s.R)], 'tire')
    body, cab, glass, a = section(s, 0.2, s.bottom_raw(0.04), s.window_z())
    d.poly([(ox + x, oy + z) for x, z in cab], 'body', 'line', 0.014)
    d.poly([(ox + x, oy + z) for x, z in body], 'body', 'line', 0.014)
    d.poly([(ox + x, oy + z) for x, z in glass], 'glass')
    # Капот: силовой горб с двумя щелями
    zh = s.top(0.2)
    d.poly([(ox - 0.26, oy + zh), (ox - 0.2, oy + zh + 0.035), (ox + 0.2, oy + zh + 0.035), (ox + 0.26, oy + zh)], 'body2')
    # Фары-клинья
    hl = f['headlight']
    hz = hl['h'] * H
    for sgn in (-1, 1):
        xo, xi = sgn * hl['outer'] * a, sgn * hl['inner'] * a
        hh = hl['height']
        pts = [(xi, hz - hh * 0.25), (xo, hz - hh * 0.5 + hl['rake']), (xo, hz + hh * 0.5 + hl['rake']),
               (xi, hz + hh * 0.3)]
        d.poly([(ox + x, oy + z) for x, z in pts], 'head', 'line', 0.008)
        d.line([(ox + xi, oy + hz - hh * 0.45), (ox + lerp(xi, xo, 0.85), oy + hz - hh * 0.6 + hl['rake'] * 0.8)],
               'head', 0.012)
    # Низкая широкая сетка
    gr = f['grille']
    gw, gz, gh = gr['width'] * W / 2, gr['h'] * H, gr['height']
    grille = superellipse(gw, gh / 2, 5, 40)
    d.poly([(ox + x, oy + gz + z) for x, z in grille], 'dark', 'line', 0.008)
    for k in range(-8, 9):
        x0 = ox + k * gw / 8.5
        d.line([(x0 - 0.03, oy + gz - gh * 0.35), (x0 + 0.03, oy + gz + gh * 0.35)], 'body2', 0.006)
    # Угловые воздухозаборники с вертикальными лопатками
    it = f['intakes']
    iz, iw, ih = it['h'] * H, it['width'], it['height']
    for sgn in (-1, 1):
        cx = ox + sgn * (a * 0.78)
        box = [(cx - iw / 2, oy + iz - ih / 2), (cx + iw / 2, oy + iz - ih / 2),
               (cx + iw / 2, oy + iz + ih / 2), (cx - iw / 2, oy + iz + ih / 2)]
        d.poly(box, 'dark', 'line', 0.006)
        for k in range(1, 4):
            x = cx - iw / 2 + iw * k / 4
            d.line([(x, oy + iz - ih / 2), (x, oy + iz + ih / 2)], 'body2', 0.01)
    # Зеркала
    zw = s.window_z()
    for sgn in (-1, 1):
        x = ox + sgn * (a + 0.06)
        d.line([(ox + sgn * (a - 0.06), oy + zw + 0.03), (x, oy + zw + 0.07)], 'dark', 0.015)
        d.poly([(x + px, oy + zw + 0.09 + pz) for px, pz in superellipse(0.06, 0.04, 3, 20)], 'body2', 'line', 0.006)
    d.line([(ox - W / 2 - 0.1, oy), (ox + W / 2 + 0.1, oy)], 'ground', 0.01)
    d.line([(ox - W / 2, oy - 0.12), (ox + W / 2, oy - 0.12)], 'dim', 0.006)
    d.text((ox, oy - 0.28), f'{W:.2f} м', 0.1, 'dim', 'CENTER')
    d.text((ox - W / 2, oy + H + 0.35), 'Спереди', 0.14)


def rear_view(d, s, ox, oy):
    r = s.spec['rear']
    H, W = s.H, s.W
    tr = s.track['rear']
    tw = s.spec['dimensions']['tireWidth']
    for sgn in (-1, 1):
        cx = ox + sgn * tr / 2
        d.poly([(cx - tw / 2, oy), (cx + tw / 2, oy), (cx + tw / 2, oy + 2 * s.R), (cx - tw / 2, oy + 2 * s.R)], 'tire')
    body, cab, glass, a = section(s, 0.8, s.bottom_raw(0.97), s.top(0.9))
    d.poly([(ox + x, oy + z) for x, z in cab], 'body', 'line', 0.014)
    d.poly([(ox + x, oy + z) for x, z in body], 'body', 'line', 0.014)
    d.poly([(ox + x, oy + z) for x, z in glass], 'glass')
    # Спойлер-лезвие
    zd = s.top(0.97)
    sp = s.spec['spoiler']['height']
    d.poly([(ox - a * 0.9, oy + zd), (ox + a * 0.9, oy + zd), (ox + a * 0.92, oy + zd + sp * 0.6),
            (ox - a * 0.92, oy + zd + sp * 0.6)], 'dark')
    # Разрезные полосы фонарей + светящаяся перемычка
    tl = r['taillight']
    tz, th = tl['h'] * H, tl['height']
    for sgn in (-1, 1):
        xo, xi = sgn * tl['outer'] * a, sgn * tl['inner'] * a
        xm = lerp(xi, xo, 0.42)
        for x0, x1 in ((xi, xm - sgn * 0.02), (xm + sgn * 0.02, xo)):
            lo, hi = sorted((x0, x1))
            d.poly([(ox + lo, oy + tz - th / 2), (ox + hi, oy + tz - th / 2), (ox + hi, oy + tz + th / 2),
                    (ox + lo, oy + tz + th / 2)], 'tail', 'line', 0.006)
    if tl.get('bridge'):
        xi = tl['inner'] * a
        d.line([(ox - xi, oy + tz), (ox + xi, oy + tz)], 'tail', 0.014)
    # Номер (без надписей), диффузор, два овальных патрубка
    d.poly([(ox - 0.26, oy + 0.42), (ox + 0.26, oy + 0.42), (ox + 0.26, oy + 0.53), (ox - 0.26, oy + 0.53)], 'rim')
    d.poly([(ox - a * 0.62, oy + 0.16), (ox + a * 0.62, oy + 0.16), (ox + a * 0.55, oy + 0.26),
            (ox - a * 0.55, oy + 0.26)], 'dark')
    for k in range(-3, 4):
        d.line([(ox + k * a * 0.14, oy + 0.16), (ox + k * a * 0.13, oy + 0.26)], 'body2', 0.01)
    sp2 = r['exhaust']['spacing'] / 2
    for sgn in (-1, 1):
        d.poly([(ox + sgn * sp2 + x, oy + 0.2 + z) for x, z in superellipse(0.06, 0.035, 2.4, 24)], 'line',
               'rim', 0.012)
    d.line([(ox - W / 2 - 0.1, oy), (ox + W / 2 + 0.1, oy)], 'ground', 0.01)
    d.text((ox - W / 2, oy + H + 0.35), 'Сзади', 0.14)


def top_view(d, s, ox, oy):
    """Вид сверху: нос слева, ось машины — по y = oy."""
    L = s.L
    X = lambda u: ox + u * L  # noqa: E731
    tw = s.spec['dimensions']['tireWidth']
    for uc, axle in ((s.u_front, 'front'), (s.u_rear, 'rear')):
        for sgn in (-1, 1):
            cy = oy + sgn * s.track[axle] / 2
            d.poly([(X(uc) - s.R, cy - tw / 2), (X(uc) + s.R, cy - tw / 2), (X(uc) + s.R, cy + tw / 2),
                    (X(uc) - s.R, cy + tw / 2)], 'tire')
    N = 160
    us = [k / N for k in range(N + 1)]
    outline = [(X(u), oy + s.half_width(u)) for u in us] + [(X(u), oy - s.half_width(u)) for u in reversed(us)]
    d.poly(outline, 'body', 'line', 0.014)
    # Кабина (стекло + крыша), сужение по tumblehome
    g = s.gh
    tb = s.sec['tumblehome']

    def cab_w(u, inset=0.0):
        w = s.half_width(u) * (1 - tb * 0.9) - inset
        # скругление к лобовому и заднему стеклу
        t0 = (u - g['windshieldBase']) / (g['roofFront'] - g['windshieldBase'])
        t1 = (g['backlightBase'] - u) / (g['backlightBase'] - g['roofRear'])
        k = min(1, max(0, min(t0, t1)))
        return w * (0.82 + 0.18 * math.sin(k * math.pi / 2))

    uc = [lerp(g['windshieldBase'], g['backlightBase'], k / 60) for k in range(61)]
    d.poly([(X(u), oy + cab_w(u)) for u in uc] + [(X(u), oy - cab_w(u)) for u in reversed(uc)], 'glass')
    ur = [lerp(g['roofFront'] - 0.02, g['roofRear'] + 0.03, k / 30) for k in range(31)]
    d.poly([(X(u), oy + cab_w(u, 0.035)) for u in ur] + [(X(u), oy - cab_w(u, 0.035)) for u in reversed(ur)], 'body')
    # Силовой горб капота с двумя щелями
    d.poly([(X(0.07), oy - 0.2), (X(0.3), oy - 0.26), (X(0.3), oy + 0.26), (X(0.07), oy + 0.2)], 'body2')
    for sgn in (-1, 1):
        d.poly([(X(0.12), oy + sgn * 0.09), (X(0.22), oy + sgn * 0.12), (X(0.22), oy + sgn * 0.17),
                (X(0.12), oy + sgn * 0.13)], 'dark')
    # Зеркала
    um = s.spec['mirrors']['u']
    for sgn in (-1, 1):
        y0 = oy + sgn * s.half_width(um)
        d.line([(X(um), y0), (X(um + 0.01), y0 + sgn * 0.08)], 'dark', 0.015)
        d.poly([(X(um + 0.012) + x, y0 + sgn * 0.11 + y) for x, y in superellipse(0.05, 0.04, 3, 20)], 'body2',
               'line', 0.006)
    # Спойлер-лезвие
    d.poly([(X(0.95), oy - s.half_width(0.95) * 0.88), (X(0.995), oy - s.half_width(0.995) * 0.9),
            (X(0.995), oy + s.half_width(0.995) * 0.9), (X(0.95), oy + s.half_width(0.95) * 0.88)], 'dark')
    d.text((X(0), oy + s.W / 2 + 0.25), 'Сверху', 0.14)


def build(spec):
    s = CarShape(spec)
    d = Drawing()
    gy = 1.6  # земля верхнего ряда
    gap = 0.55
    side_view(d, s, 0.0, gy)
    front_view(d, s, -gap - s.W / 2, gy)
    rear_view(d, s, s.L + gap + s.W / 2, gy)
    top_view(d, s, 0.0, -0.1)
    x0, y0, x1, y1 = d.bounds()
    d.text((x0, y1 + 0.35), f'{spec["id"]} · силуэт · {s.L:.2f} × {s.W:.2f} × {s.H:.2f} м, база {s.wb:.2f}',
           0.16)
    return d


def render_png(d, path, px_per_m=240, pad=0.25):
    scene.reset()
    d.blender()
    x0, y0, x1, y1 = d.bounds()
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(x1 - x0, y1 - y0)
    cam.location = ((x0 + x1) / 2, (y0 + y1) / 2, 10)
    s = bpy.context.scene
    s.render.engine = 'BLENDER_WORKBENCH'
    s.display.shading.light = 'FLAT'
    s.display.shading.color_type = 'MATERIAL'
    s.display.shading.background_type = 'VIEWPORT'
    s.display.shading.background_color = materials.hex_rgb(COL['bg'])
    s.view_settings.view_transform = 'Standard'
    s.render.resolution_x = int((x1 - x0) * px_per_m)
    s.render.resolution_y = int((y1 - y0) * px_per_m)
    s.render.film_transparent = False
    s.render.image_settings.file_format = 'PNG'
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    a = scene.args()
    spec = scene.load_spec(a.spec)
    out = os.path.join(scene.ART, 'renders', spec['id'])
    os.makedirs(out, exist_ok=True)
    d = build(spec)
    d.svg(os.path.join(out, 'silhouette.svg'))
    render_png(d, os.path.join(out, 'silhouette.png'))
    print(f'SILHOUETTE: {os.path.join(out, "silhouette.png")}')


main()
