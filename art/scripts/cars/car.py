"""Генератор машины по спецификации (BLENDER_PLAN 5.2, шаги 2–6): кузов, остекление,
лицо и корма, детали, узлы по ART_BRIEF, колёса из библиотеки дисков, сокеты.
"""

import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

from cars import wheels as wheelgen
from cars.body import Body, smooth
from lib import materials, scene
from lib.curves import superellipse

MAT_ORDER = ['paint', 'trim', 'dark']


# ---------------- примитивы ----------------

def _add_bm(dst, src):
    me = bpy.data.meshes.new('_tmp')
    src.to_mesh(me)
    dst.from_mesh(me)
    bpy.data.meshes.remove(me)
    src.free()


def slab(body, outline, view, lift, depth, mat=0, steps=0):
    """Накладка по контуру на поверхность кузова: лицо на lift над поверхностью, тыл — на depth под ней.

    steps > 0 — сетка внутри контура (для крупных накладок на изогнутой поверхности).
    """
    bm = bmesh.new()
    hits = body.project(outline, view)
    if any(h[0] is None for h in hits):
        bm.free()
        return None
    top = [bm.verts.new(p + n * lift) for p, n in hits]
    bot = [bm.verts.new(p - n * depth) for p, n in hits]
    nn = len(top)
    faces = [bm.faces.new(top), bm.faces.new(bot[::-1])]
    for i in range(nn):
        j = (i + 1) % nn
        faces.append(bm.faces.new((top[i], top[j], bot[j], bot[i])))
    for f in faces:
        f.material_index = mat
    bm.normal_update()
    # Замкнутая накладка: нормали наружу ⇔ объём положительный (надёжнее, чем по нормали лица)
    if bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=faces)
    return bm


def slab_grid(body, quad, view, lift, depth, mat=0, nu=8, nv=3):
    """Накладка по четырёхугольнику, повторяющая изогнутую поверхность: сетка nu × nv,
    каждый узел проецируется на кузов отдельно (фары, огибающие угол носа)."""
    p00, p10, p11, p01 = quad

    def at(i, j):
        s_, t_ = i / nu, j / nv
        return tuple((1 - s_) * (1 - t_) * a + s_ * (1 - t_) * b + s_ * t_ * c + (1 - s_) * t_ * d
                     for a, b, c, d in zip(p00, p10, p11, p01))

    grid2 = [[at(i, j) for i in range(nu + 1)] for j in range(nv + 1)]
    hits = [[h for h in body.project(row, view)] for row in grid2]
    if any(h[0] is None for row in hits for h in row):
        return None
    bm = bmesh.new()
    top = [[bm.verts.new(p + n * lift) for p, n in row] for row in hits]
    bot = [[bm.verts.new(p - n * depth) for p, n in row] for row in hits]
    fs = []
    for j in range(nv):
        for i in range(nu):
            fs.append(bm.faces.new((top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i])))
            fs.append(bm.faces.new((bot[j][i], bot[j + 1][i], bot[j + 1][i + 1], bot[j][i + 1])))
    ring_t = [top[0][i] for i in range(nu)] + [top[j][nu] for j in range(nv)] +         [top[nv][i] for i in range(nu, 0, -1)] + [top[j][0] for j in range(nv, 0, -1)]
    ring_b = [bot[0][i] for i in range(nu)] + [bot[j][nu] for j in range(nv)] +         [bot[nv][i] for i in range(nu, 0, -1)] + [bot[j][0] for j in range(nv, 0, -1)]
    for k in range(len(ring_t)):
        k2 = (k + 1) % len(ring_t)
        fs.append(bm.faces.new((ring_t[k2], ring_t[k], ring_b[k], ring_b[k2])))
    for f in fs:
        f.material_index = mat
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return bm


def strip_path(body, path, view, width, lift, depth, mat):
    """Тонкая полоса вдоль пути (u/x, z) — одна накладка (зазор, светодиодная полоса)."""
    sx = body.s.L if view.startswith('side') else 1.0  # путь сбоку задан в (u, z)
    left, right = [], []
    for i, p in enumerate(path):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, len(path) - 1)]
        dx, dy = (b[0] - a[0]) * sx, b[1] - a[1]
        ln = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / ln * width / 2 / sx, dx / ln * width / 2
        left.append((p[0] + nx, p[1] + ny))
        right.append((p[0] - nx, p[1] - ny))
    outline = left + right[::-1]
    return slab(body, outline, view, lift, depth, mat) or bmesh.new()


def box(x0, x1, y0, y1, z0, z1, mat=0, bm=None):
    bm = bm or bmesh.new()
    res = bmesh.ops.create_cube(bm, size=1.0)
    vs = res['verts']
    bmesh.ops.transform(bm, verts=vs, matrix=Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))
    bmesh.ops.translate(bm, verts=vs, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    for f in {f for v in vs for f in v.link_faces}:
        f.material_index = mat
    return bm


def extrude_profile(profile_yz, x0, x1, mat=0, bm=None):
    """Замкнутый профиль (y, z) вытягивается по X от x0 до x1."""
    bm = bm or bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in profile_yz]
    b = [bm.verts.new((x1, y, z)) for y, z in profile_yz]
    n = len(a)
    fs = [bm.faces.new(a[::-1]), bm.faces.new(b)]
    for i in range(n):
        j = (i + 1) % n
        fs.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    for f in fs:
        f.material_index = mat
    bm.normal_update()
    if fs[1].normal.x < 0:
        bmesh.ops.reverse_faces(bm, faces=fs)
    return bm


# ---------------- части ----------------

def split_body(body, bm, tags):
    """Лофт → body, hood, bumper_front, bumper_rear, glass (bmesh для каждого).

    Грани размечены строками сечения (body.section): F — рамка окна, C 1..KS−1 — боковое стекло,
    C ≥ KS — крыша/лобовое/заднее стекло. Станции лофта стоят точно по границам окон.
    """
    from cars.body import KS
    g = body.g
    ws, rf, rr, bb = g['windshieldBase'], g['roofFront'], g['roofRear'], g['backlightBase']
    ua, uq, ub = body.ua, body.uq, body.ub
    parts = {k: set() for k in ('body', 'hood', 'bumper_front', 'bumper_rear', 'glass')}
    mats = {}
    for f, (u, sg, band, side) in tags.items():
        part, mat = 'body', 0
        if sg == 'cap' or u < 0.055:
            part = 'bumper_front'
        elif u > 0.958:
            part = 'bumper_rear'
        elif sg in ('C', 'F') and u < ws:
            part = 'hood'
        elif sg == 'C' and band >= KS and (ws < u < rf or rr < u < bb):
            part = 'glass'  # лобовое и заднее стекло
        elif sg == 'C' and band < KS and ua < u < uq:
            if abs(u - ub) < 0.007:
                mat = 1  # средняя стойка — чёрная
            else:
                part = 'glass'  # боковые окна
        elif sg == 'F' and ua < u < uq:
            mat = 1  # чёрная рамка под окнами
        # Колёсные ниши и днище (грани смотрят вниз) — тёмные
        if sg in ('A', 'B') and f.normal.z < -0.5:
            mat = 2
        parts[part].add(f)
        mats[f] = mat
    # Разметка — в слое данных граней (копируется вместе с bmesh, в отличие от индексов)
    names = list(parts)
    layer = bm.faces.layers.int['part']
    for i, name in enumerate(names):
        for f in parts[name]:
            f[layer] = i
            f.material_index = mats[f]
    out = {}
    for i, name in enumerate(names):
        nb = bm.copy()
        ly = nb.faces.layers.int['part']
        bmesh.ops.delete(nb, geom=[f for f in nb.faces if f[ly] != i], context='FACES')
        bmesh.ops.delete(nb, geom=[v for v in nb.verts if not v.link_faces], context='VERTS')
        nb.faces.layers.int.remove(ly)
        if name == 'glass':
            # стекло — на 5 мм внутрь, кромка остаётся в проёме
            nb.normal_update()
            for v in nb.verts:
                v.co -= v.normal * 0.005
            for f in nb.faces:
                f.material_index = 0
        out[name] = nb
    return out


def _circle(cx, cz, r, n=20):
    return [(cx + px, cz + pz) for px, pz in superellipse(r, r, 2, n)[:-1]]


def _put(dst, b):
    if b:
        _add_bm(dst, b)


# ---- библиотека элементов лица (spec.face.*.style) ----

def headlights(body, spec, parts, lights):
    """Фары по стилю: slim_wedge | swept | rect_bar | round_twin | led_strip | popup."""
    s = body.s
    hl = spec['face']['headlight']
    st = hl.get('style', 'slim_wedge')
    a = s.half_width(0.03)
    hz, hh = hl['h'] * s.H, hl['height']
    rake = hl.get('rake', 0.0)
    if st == 'led_strip':
        # Тонкая светящаяся полоса через весь нос + тёмная подложка
        xo = hl['outer'] * a
        path = [(-xo, hz + rake), (-xo * 0.5, hz), (xo * 0.5, hz), (xo, hz + rake)]
        _put(lights, strip_path(body, path, 'front', hh, 0.006, 0.01, 0))
        _put(parts['bumper_front'], strip_path(body, path, 'front', hh * 2.4, 0.002, 0.01, 2))
        return
    for sgn in (-1, 1):
        xo, xi = sgn * hl['outer'] * a, sgn * hl['inner'] * a
        if st in ('slim_wedge', 'swept'):
            k = 0.25 if st == 'slim_wedge' else 0.05
            wedge = [(xi, hz - hh * k), (xo, hz - hh * 0.5 + rake), (xo, hz + hh * 0.5 + rake), (xi, hz + hh * 0.3)]
            _put(lights, slab_grid(body, wedge, 'front', 0.005, 0.02, 0, nu=10, nv=3))
            led = [(xi, hz - hh * 0.45), (xi + (xo - xi) * 0.85, hz - hh * 0.6 + rake * 0.8)]
            _put(lights, strip_path(body, led, 'front', 0.012, 0.006, 0.01, 0))
        elif st == 'rect_bar':
            q = [(xi, hz - hh / 2), (xo, hz - hh / 2 + rake), (xo, hz + hh / 2 + rake), (xi, hz + hh / 2)]
            _put(parts['bumper_front'], slab_grid(body, q, 'front', 0.003, 0.02, 2, nu=8, nv=2))
            # две линзы внутри тёмной рамки
            for t in (0.3, 0.7):
                cx = xi + (xo - xi) * t
                _put(lights, slab(body, _circle(cx, hz + rake * t, hh * 0.32), 'front', 0.008, 0.01, 0))
            _put(lights, strip_path(body, [(xi, hz - hh * 0.62), (xo, hz - hh * 0.62 + rake)], 'front',
                                    0.01, 0.006, 0.01, 0))
        elif st == 'round_twin':
            r = hh / 2
            for t in (0.25, 0.75):
                cx = xi + (xo - xi) * t
                _put(parts['bumper_front'], slab(body, _circle(cx, hz, r * 1.25), 'front', 0.003, 0.02, 2))
                _put(lights, slab(body, _circle(cx, hz, r), 'front', 0.008, 0.01, 0))
        elif st == 'popup':
            # Подъёмные фары в закрытом положении: крышки в цвет кузова на капоте с тёмным зазором,
            # ниже в бампере — узкий ходовой огонь
            u0, u1 = hl.get('u0', 0.035), hl.get('u1', 0.1)
            xa, xb = sorted((xi, xo))
            lid = [(xa, u0), (xb, u0), (xb, u1), (xa, u1)]
            _put(parts['hood'], slab_grid(body, [(xa - sgn * 0.0, u0 - 0.006), (xb, u0 - 0.006), (xb, u1 + 0.006),
                                                  (xa, u1 + 0.006)], 'top', 0.001, 0.01, 2, nu=4, nv=2))
            # Крышка — отдельный узел popup_L / popup_R (клиент поднимает её на петле у задней кромки);
            # под крышкой — фара, которая смотрит вперёд, когда крышка поднята
            pop = slab_grid(body, lid, 'top', 0.004, 0.01, 0, nu=6, nv=3) or bmesh.new()
            lamp = slab_grid(body, [(xa + 0.02, u0 + 0.008), (xb - 0.02, u0 + 0.008), (xb - 0.02, u1 - 0.008),
                                    (xa + 0.02, u1 - 0.008)], 'top', -0.006, 0.014, 3, nu=4, nv=2)
            _put(pop, lamp)
            parts.setdefault('popups', {})['popup_L' if sgn < 0 else 'popup_R'] = (pop, (xa + xb) / 2, u1)
            _put(lights, strip_path(body, [(xi, hz), (xo, hz + rake)], 'front', hh * 0.35, 0.006, 0.01, 0))


def grille(body, spec, parts):
    """Решётка: low_mesh_wide | split_twin | trapezoid | upper_lower | closed."""
    s = body.s
    gr = spec['face']['grille']
    st = gr.get('style', 'low_mesh_wide')
    gw, gz, gh = gr['width'] * s.W / 2, gr['h'] * s.H, gr['height']
    fb = parts['bumper_front']

    def bars(x0, x1, z, h, n):
        for k in range(n):
            x = x0 + (x1 - x0) * (k + 0.5) / n
            _put(fb, slab(body, [(x - 0.008, z - h * 0.35), (x + 0.008, z - h * 0.35), (x + 0.008, z + h * 0.35),
                                 (x - 0.008, z + h * 0.35)], 'front', 0.006, 0.004, 1))

    if st == 'low_mesh_wide':
        out = superellipse(gw, gh / 2, 5, 40)[:-1]
        _put(fb, slab(body, [(x, gz + z) for x, z in out], 'front', 0.002, 0.03, 2))
        for k in range(-9, 10):
            x0 = k * gw / 10
            bar = [(x0 - 0.035, gz - gh * 0.32), (x0 - 0.02, gz - gh * 0.32), (x0 + 0.035, gz + gh * 0.32),
                   (x0 + 0.02, gz + gh * 0.32)]
            _put(fb, slab(body, bar, 'front', 0.006, 0.005, 1))
    elif st == 'split_twin':
        for sgn in (-1, 1):
            cx = sgn * gw * 0.52
            out = superellipse(gw * 0.44, gh / 2, 4, 32)[:-1]
            _put(fb, slab(body, [(cx + x, gz + z) for x, z in out], 'front', 0.002, 0.03, 2))
            for k in range(3):
                z = gz - gh * 0.25 + gh * 0.25 * k
                _put(fb, strip_path(body, [(cx - gw * 0.38, z), (cx + gw * 0.38, z)], 'front', 0.01, 0.006, 0.004, 1))
    elif st == 'trapezoid':
        poly = [(-gw, gz - gh / 2), (gw, gz - gh / 2), (gw * 0.82, gz + gh / 2), (-gw * 0.82, gz + gh / 2)]
        _put(fb, slab_grid(body, poly, 'front', 0.002, 0.03, 2, nu=8, nv=2))
        for k in range(4):
            z = gz - gh * 0.36 + gh * 0.24 * k
            w = gw * (0.96 - 0.16 * k / 3)
            _put(fb, strip_path(body, [(-w, z), (w, z)], 'front', 0.012, 0.006, 0.004, 1))
    elif st == 'upper_lower':
        # Узкая верхняя щель между фарами + низкая сетка
        hz = spec['face']['headlight']['h'] * s.H
        iw = spec['face']['headlight']['inner'] * s.half_width(0.03)
        _put(fb, strip_path(body, [(-iw * 0.95, hz), (iw * 0.95, hz)], 'front', 0.035, 0.003, 0.02, 2))
        out = superellipse(gw, gh / 2, 6, 40)[:-1]
        _put(fb, slab(body, [(x, gz + z) for x, z in out], 'front', 0.002, 0.03, 2))
        bars(-gw * 0.9, gw * 0.9, gz, gh, 14)
    elif st == 'closed':
        # Глухая панель: только тонкая щель датчиков и узкий нижний воздуховод
        _put(fb, strip_path(body, [(-gw * 0.5, gz + gh * 0.2), (gw * 0.5, gz + gh * 0.2)], 'front', 0.012, 0.002,
                            0.01, 2))
        _put(fb, strip_path(body, [(-gw, gz - gh * 0.3), (gw, gz - gh * 0.3)], 'front', 0.035, 0.002, 0.02, 2))


def intakes(body, spec, parts):
    """Боковые воздухозаборники бампера: corner_blades | side_vertical | none."""
    s = body.s
    it = spec['face'].get('intakes', {})
    st = it.get('style', 'corner_blades')
    if st == 'none':
        return
    a = s.half_width(0.03)
    iz, iw, ih = it['h'] * s.H, it['width'], it['height']
    for sgn in (-1, 1):
        cx = sgn * a * it.get('x', 0.74)
        if st == 'side_vertical':
            # Высокий проём-«клык» с наклоном наружу
            rect = [(cx - iw / 2, iz - ih / 2), (cx + iw / 2, iz - ih / 2), (cx + iw / 2 + sgn * 0.03, iz + ih / 2),
                    (cx - iw / 2 + sgn * 0.03, iz + ih / 2)]
            _put(parts['bumper_front'], slab_grid(body, rect, 'front', 0.002, 0.03, 2, nu=3, nv=4))
            _put(parts['bumper_front'], strip_path(body, [(cx - iw / 2, iz), (cx + iw / 2, iz)], 'front', 0.012,
                                                   0.006, 0.004, 1))
            continue
        rect = [(cx - iw / 2, iz - ih / 2), (cx + iw / 2, iz - ih / 2), (cx + iw / 2, iz + ih / 2),
                (cx - iw / 2, iz + ih / 2)]
        _put(parts['bumper_front'], slab_grid(body, rect, 'front', 0.002, 0.03, 2, nu=4, nv=2))
        for k in range(1, 4):
            x = cx - iw / 2 + iw * k / 4
            _put(parts['bumper_front'], slab(body, [(x - 0.006, iz - ih / 2), (x + 0.006, iz - ih / 2),
                                                    (x + 0.006, iz + ih / 2), (x - 0.006, iz + ih / 2)],
                                             'front', 0.006, 0.004, 1))


def face_details(body, spec, parts):
    """Фары, решётка, воздухозаборники, губа — проекцией на перёд."""
    s = body.s
    lights = bmesh.new()
    headlights(body, spec, parts, lights)
    grille(body, spec, parts)
    intakes(body, spec, parts)
    a = s.half_width(0.03)
    lip = [(-a * 0.85, s.bottom_raw(0.02) + 0.005), (a * 0.85, s.bottom_raw(0.02) + 0.005),
           (a * 0.8, s.bottom_raw(0.02) + 0.03), (-a * 0.8, s.bottom_raw(0.02) + 0.03)]
    _put(parts['bumper_front'], slab(body, lip, 'front', 0.02, 0.01, 2))
    return lights


def taillights(body, spec, lights):
    """Фонари: split_bar | full_bar | round_twin | block | c_shape."""
    s = body.s
    tl = spec['rear']['taillight']
    st = tl.get('style', 'split_bar')
    a = s.half_width(0.985)
    tz, th = tl['h'] * s.H, tl['height']
    if st == 'full_bar':
        xo = tl['outer'] * a
        _put(lights, strip_path(body, [(-xo, tz), (xo, tz)], 'rear', th, 0.005, 0.01, 0))
        return
    for sgn in (-1, 1):
        xo, xi = sgn * tl['outer'] * a, sgn * tl['inner'] * a
        if st == 'split_bar':
            xm = xi + (xo - xi) * 0.42
            for x0, x1 in ((xi, xm - sgn * 0.02), (xm + sgn * 0.02, xo)):
                lo, hi = sorted((x0, x1))
                _put(lights, slab_grid(body, [(lo, tz - th / 2), (hi, tz - th / 2), (hi, tz + th / 2), (lo, tz + th / 2)],
                                       'rear', 0.005, 0.02, 0, nu=6, nv=2))
        elif st == 'round_twin':
            r = th / 2
            for t in (0.3, 0.75):
                _put(lights, slab(body, _circle(xi + (xo - xi) * t, tz, r), 'rear', 0.006, 0.01, 0))
        elif st == 'block':
            lo, hi = sorted((xi, xo))
            _put(lights, slab_grid(body, [(lo, tz - th / 2), (hi, tz - th / 2), (hi, tz + th / 2), (lo, tz + th / 2)],
                                   'rear', 0.005, 0.02, 0, nu=6, nv=2))
        elif st == 'c_shape':
            # «Скобка»: верхняя и нижняя полосы, соединённые у внешнего края
            for z in (tz + th / 2, tz - th / 2):
                _put(lights, strip_path(body, [(xi, z), (xo, z)], 'rear', 0.018, 0.005, 0.01, 0))
            _put(lights, strip_path(body, [(xo - sgn * 0.009, tz - th / 2 - 0.0085), (xo - sgn * 0.009, tz + th / 2 + 0.0085)],
                                    'rear', 0.017, 0.0052, 0.01, 0))
    if tl.get('bridge'):
        xi = tl['inner'] * a
        _put(lights, strip_path(body, [(-xi, tz), (xi, tz)], 'rear', 0.014, 0.004, 0.01, 0))


def rear_details(body, spec, parts):
    s = body.s
    a = s.half_width(0.985)
    lights = bmesh.new()
    taillights(body, spec, lights)
    # Диффузор и рёбра
    zb = s.bottom_raw(0.99)
    style = spec['rear'].get('diffuser', 'subtle')
    k = 1.0 if style == 'subtle' else 1.3
    diff = [(-a * 0.62, zb + 0.01), (a * 0.62, zb + 0.01), (a * 0.55, zb + 0.11 * k), (-a * 0.55, zb + 0.11 * k)]
    _put(parts['bumper_rear'], slab(body, diff, 'rear', 0.003, 0.03, 2))
    for i in range(-3, 4):
        x = i * a * 0.14
        _put(parts['bumper_rear'], slab(body, [(x - 0.006, zb + 0.01), (x + 0.006, zb + 0.01), (x + 0.006, zb + 0.1 * k),
                                               (x - 0.006, zb + 0.1 * k)], 'rear', 0.03, 0.004, 1))
    # Ниша номера
    pz = spec['rear'].get('plateH', 0.42 / s.H) * s.H
    _put(parts['bumper_rear'], slab(body, [(-0.27, pz), (0.27, pz), (0.27, pz + 0.12), (-0.27, pz + 0.12)], 'rear',
                                    0.001, 0.02, 2))
    return lights


def side_details(body, spec, parts):
    """Воздухозаборник перед задним колесом, зазоры дверей, ручки, щели на капоте."""
    s, g = body.s, body.g
    zw = s.window_z()
    si = spec.get('sideIntake')
    for view in ('side_r', 'side_l'):
        if si:
            poly = [(si['u0'], si['h0'] * s.H), (si['u1'], si['h0'] * s.H + 0.02),
                    (si['u1'] - 0.008, si['h1'] * s.H), (si['u0'] + 0.012, si['h1'] * s.H - 0.03)]
            if view == 'side_l':
                poly.reverse()
            _put(parts['body'], slab(body, poly, view, 0.001, 0.03, 2))
        # Зазоры: передняя кромка двери и задняя (у средней стойки)
        ud, ub = body.u_door, body.ub + 0.008
        for path in ([(ud, zw - 0.01), (ud - 0.001, 0.33), (ud + 0.01, s.bottom(ud + 0.01) + 0.03)],
                     [(ub, zw - 0.005), (ub + 0.005, 0.4), (ub + 0.01, s.bottom(ub + 0.01) + 0.04)]):
            _add_bm(parts['body'], strip_path(body, path, view, 0.005, 0.001, 0.004, 2))
        # Ручка
        hu = body.ub - 0.045
        b = slab(body, [(hu, zw - 0.075), (hu + 0.028, zw - 0.075), (hu + 0.028, zw - 0.055),
                        (hu, zw - 0.055)][::(1 if view == 'side_r' else -1)], view, 0.006, 0.004, 1)
        if b:
            _add_bm(parts['body'], b)
    hood_details(body, spec, parts)
    _ = g


def hood_details(body, spec, parts):
    """Капот: power_bulge_slots (щели на горбу) | center_scoop | vents | bulge | flat."""
    st = spec.get('hood', {}).get('style', 'flat')
    ws = body.g['windshieldBase']
    hood = parts['hood']
    if st == 'power_bulge_slots':
        for sgn in (-1, 1):
            slot = [(sgn * 0.09, 0.12), (sgn * 0.12, 0.22), (sgn * 0.17, 0.22), (sgn * 0.13, 0.12)]
            if sgn < 0:
                slot.reverse()
            _put(hood, slab(body, slot, 'top', 0.001, 0.02, 2))
    elif st == 'center_scoop':
        # Воздухозаборник на горбу: короб в цвет кузова и тёмный проём спереди
        u0, u1 = ws * 0.45, ws * 0.62
        _put(hood, slab_grid(body, [(-0.2, u0), (0.2, u0), (0.17, u1), (-0.17, u1)], 'top', 0.035, 0.01, 0,
                             nu=6, nv=3))
        _put(hood, slab_grid(body, [(-0.17, u0 - 0.004), (0.17, u0 - 0.004), (0.15, u0 + 0.012),
                                    (-0.15, u0 + 0.012)], 'top', 0.038, 0.004, 2, nu=4, nv=1))
    elif st == 'vents':
        for sgn in (-1, 1):
            xa, xb = sorted((sgn * 0.22, sgn * 0.44))
            u0, u1 = ws * 0.35, ws * 0.62
            _put(hood, slab_grid(body, [(xa, u0), (xb, u0), (xb, u1), (xa, u1)], 'top', 0.002, 0.02, 2, nu=4, nv=3))
            for k in range(5):
                uu = u0 + (u1 - u0) * (k + 0.5) / 5
                _put(hood, slab(body, [(xa + 0.01, uu - 0.004), (xb - 0.01, uu - 0.004), (xb - 0.01, uu + 0.004),
                                       (xa + 0.01, uu + 0.004)], 'top', 0.007, 0.004, 1))


def mirrors(body, spec):
    s = body.s
    bm = bmesh.new()
    um = spec['mirrors']['u']
    zw = s.window_z()
    y = body.y(um)
    for sgn in (-1, 1):
        loc, nrm = body.hit((sgn * 10, y, zw + 0.03), (-sgn, 0, 0))
        if loc is None:
            continue
        # ножка
        box(loc.x - 0.008 * sgn - 0.008, loc.x + sgn * 0.07 + 0.008, y - 0.03, y - 0.01, zw + 0.03, zw + 0.045, 2, bm)
        # корпус — суперэллипс, вытянутый по X
        prof = [(y + py, zw + 0.085 + pz) for py, pz in superellipse(0.07, 0.042, 3, 16)[:-1]]
        x0 = loc.x + sgn * 0.06
        x1 = loc.x + sgn * 0.19
        _add_bm(bm, extrude_profile(prof, min(x0, x1), max(x0, x1), 0))
    return bm


def wheel_liners(body):
    """Тёмные подкрылки: полудиски внутри арок — сквозь нишу не видно фон."""
    s = body.s
    bm = bmesh.new()
    for axle, uc in (('front', s.u_front), ('rear', s.u_rear)):
        r = s.arch[axle]['radius'] + 0.03
        yc = body.y(uc)
        xi = s.track[axle] / 2 - s.spec['dimensions']['tireWidth'] / 2 - 0.04
        prof = [(yc + r * math.cos(math.pi * k / 16), s.R + r * math.sin(math.pi * k / 16)) for k in range(17)]
        prof.append((yc - r, s.R - 0.08))
        prof.append((yc + r, s.R - 0.08))
        prof = [prof[-1]] + prof[:-1]
        for sgn in (-1, 1):
            x0 = sgn * xi
            _add_bm(bm, extrude_profile(prof, min(x0, x0 - sgn * 0.01), max(x0, x0 - sgn * 0.01), 2))
    return bm


def skirts(body):
    s = body.s
    bm = bmesh.new()
    u0 = s.u_front + s.arch['front']['radius'] / s.L + 0.01
    u1 = s.u_rear - s.arch['rear']['radius'] / s.L - 0.01
    prof_z = (s.clear + 0.005, s.clear + 0.075)
    for sgn in (-1, 1):
        steps = 12
        top, bot = [], []
        for k in range(steps + 1):
            u = u0 + (u1 - u0) * k / steps
            y = body.y(u)
            loc, _ = body.hit((sgn * 10, y, prof_z[1]), (-sgn, 0, 0))
            xo = (loc.x if loc else sgn * s.half_width(u)) + sgn * 0.018
            top.append((xo, y))
            bot.append((xo - sgn * 0.05, y))
        # сечение порога: трапеция, вытянутая вдоль длины
        rings = []
        for (xo, y), (xi, _) in zip(top, bot):
            rings.append([bm.verts.new(v) for v in ((xi, y, prof_z[0]), (xo, y, prof_z[0] + 0.01),
                                                     (xo, y, prof_z[1] - 0.01), (xi, y, prof_z[1]))])
        fs = []
        for i in range(len(rings) - 1):
            for j in range(4):
                j2 = (j + 1) % 4
                fs.append(bm.faces.new((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j])))
        fs.append(bm.faces.new(rings[0]))
        fs.append(bm.faces.new(rings[-1][::-1]))
        bmesh.ops.recalc_face_normals(bm, faces=fs)
    return bm


def spoiler_mount(body, spec):
    """Где стоит спойлер: кромка крышки багажника (deck) или задняя кромка крыши (roof)."""
    if spec.get('spoiler', {}).get('at') == 'roof':
        rr = body.g['roofRear']
        return 'roof', rr - 0.035, rr + 0.004
    return 'deck', 0.958, 0.994


def spoiler(body, spec):
    """Спойлер: ducktail_blade | lip | roof | wing | none."""
    s = body.s
    sp = spec.get('spoiler', {})
    st = sp.get('style', 'ducktail_blade')
    if st == 'none':
        return bmesh.new()
    if st == 'wing':
        from cars.kits import Anchors, gt_wing
        return gt_wing(body, Anchors(body), span=s.half_width(0.95) * sp.get('span', 0.82),
                       rise=sp.get('height', 0.2), chord=sp.get('chord', 0.24), mats=(0, 2, 0))
    h = sp.get('height', 0.02 if st == 'lip' else 0.05)
    mount, u0, u1 = spoiler_mount(body, spec)
    a = s.half_width(u0) * (0.9 if mount == 'deck' else 0.78)
    y0, y1 = body.y(u0), body.y(u1)
    z0, z1 = s.top(u0), s.top(u1)
    if mount == 'roof':
        # Козырёк над задним стеклом: продолжает крышу назад
        prof = [(y0, z0 - 0.012), (y1, z1 - 0.014), (y1 - 0.1, z1 - 0.012 + h * 0.3), (y1 - 0.1, z1 + h * 0.3),
                (y0 + 0.02, z0 + 0.008)]
    else:
        prof = [(y0, z0 - 0.004), (y1, z1 - 0.01), (y1 - 0.01, z1 + h), (y1 + 0.02, z1 + h - 0.012),
                (y0 + 0.02, z0 + 0.006)]
    # профиль (y, z) — порядок против часовой при взгляде с +X
    return extrude_profile(prof, -a, a, 0)


def _tip(bm, cx, z, y, rx, rz, n=2.4):
    """Патрубок: наружная труба, внутренняя, торец и заглушка."""
    prof = [(cx + px, z + pz) for px, pz in superellipse(rx, rz, n, 20)[:-1]]
    inner = [(cx + px, z + pz) for px, pz in superellipse(rx * 0.78, rz * 0.7, n, 20)[:-1]]
    ring_o = [bm.verts.new((x, y, zz)) for x, zz in prof]
    ring_o2 = [bm.verts.new((x, y + 0.14, zz)) for x, zz in prof]
    ring_i = [bm.verts.new((x, y, zz)) for x, zz in inner]
    ring_i2 = [bm.verts.new((x, y + 0.1, zz)) for x, zz in inner]
    nn = len(prof)
    fs = []
    for i in range(nn):
        j = (i + 1) % nn
        fs.append(bm.faces.new((ring_o[i], ring_o[j], ring_o2[j], ring_o2[i])))  # наружная труба
        fs.append(bm.faces.new((ring_i[j], ring_i[i], ring_i2[i], ring_i2[j])))  # внутренняя
        fs.append(bm.faces.new((ring_o[j], ring_o[i], ring_i[i], ring_i[j])))  # торец
        fs.append(bm.faces.new((ring_o2[i], ring_o2[j], ring_i2[j], ring_i2[i])))  # заглушка сзади
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    for f in fs:
        f.material_index = 0


def exhaust(body, spec):
    """Выхлоп: twin_oval | quad | single_center | split_round | none (электромобиль)."""
    s = body.s
    bm = bmesh.new()
    ex = spec['rear']['exhaust']
    st = ex.get('style', 'twin_oval')
    sp = ex.get('spacing', 0.32) / 2
    y = body.y(1.0) - 0.03
    z = s.bottom_raw(0.99) + ex.get('lift', 0.075)
    if st == 'twin_oval':
        for sgn in (-1, 1):
            _tip(bm, sgn * sp, z, y, 0.055, 0.032)
    elif st == 'quad':
        for sgn in (-1, 1):
            for d in (-0.055, 0.055):
                _tip(bm, sgn * sp + d, z, y, 0.042, 0.042, 2.0)
    elif st == 'single_center':
        _tip(bm, 0.0, z, y, 0.085, 0.045, 3.0)
    elif st == 'split_round':
        for sgn in (-1, 1):
            _tip(bm, sgn * sp, z, y, 0.048, 0.048, 2.0)
    return bm


def interior(body):
    s = body.s
    bm = bmesh.new()
    zf = s.clear + 0.18
    for sgn in (-1, 1):
        cx = sgn * 0.37
        yc = body.y(0.53)
        box(cx - 0.24, cx + 0.24, yc - 0.25, yc + 0.25, zf, zf + 0.14, 0, bm)  # подушка
        box(cx - 0.23, cx + 0.23, yc - 0.33, yc - 0.21, zf + 0.1, zf + 0.68, 0, bm)  # спинка
    yd = body.y(0.40)
    # панель — не дальше основания лобового стекла и не выше капота у стекла (иначе проступает сквозь капот)
    ws = body.g['windshieldBase']
    dz = min(s.window_z() - 0.02, s.top(ws) - 0.02)
    box(-0.78, 0.78, yd - 0.12, min(yd + 0.18, body.y(ws) - 0.03), dz - 0.18, dz, 0, bm)  # панель
    box(-0.1, 0.1, body.y(0.6), body.y(0.42), zf, zf + 0.22, 0, bm)  # тоннель
    # руль: кольцо
    res = bmesh.ops.create_circle(bm, cap_ends=False, segments=16, radius=0.18)
    ring = res['verts']
    bmesh.ops.rotate(bm, verts=ring, matrix=Matrix.Rotation(math.radians(70), 3, 'X'))
    bmesh.ops.translate(bm, verts=ring, vec=(-0.37, body.y(0.45), s.window_z() - 0.06))
    ext = bmesh.ops.extrude_edge_only(bm, edges=[e for e in bm.edges if all(v in ring for v in e.verts)])
    nv = [v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.scale(bm, vec=(0.85, 0.85, 0.85), verts=nv,
                    space=Matrix.Translation(-Vector((-0.37, body.y(0.45), s.window_z() - 0.06))))
    return bm


# ---------------- сборка ----------------

def build(spec):
    body = Body(spec)
    s = body.s
    common = json.load(open(os.path.join(scene.ART, 'specs', 'wheels', '_common.json'), encoding='utf-8'))
    wspec = json.load(open(os.path.join(scene.ART, 'specs', 'wheels', f'{spec["wheels"]["rim"]}.json'),
                           encoding='utf-8'))
    wmats = wheelgen.wheel_materials(wspec, common)
    mats = materials.car_set(spec['paint']['default'])
    body_mats = [mats['paint'], mats['trim'], mats['dark']]
    root = scene.empty('car_root', display='ARROWS', size=0.5)

    bm, tags = body.build()
    parts = split_body(body, bm, tags)
    lights_f = face_details(body, spec, parts)
    lights_r = rear_details(body, spec, parts)
    side_details(body, spec, parts)
    _add_bm(parts['body'], mirrors(body, spec))
    _add_bm(parts['body'], wheel_liners(body))
    bm.free()

    def obj(name, b, mlist):
        o = scene.mesh_object(name, b, root, mlist)
        return o

    objs = {}
    for name in ('body', 'hood', 'bumper_front', 'bumper_rear'):
        objs[name] = obj(name, parts[name], body_mats)
    objs['glass'] = obj('glass', parts['glass'], [mats['glass']])
    objs['lights_front'] = obj('lights_front', lights_f, [mats['headlight']])
    objs['lights_rear'] = obj('lights_rear', lights_r, [mats['taillight']])
    objs['skirts'] = obj('skirts', skirts(body), [mats['paint']])
    # слоты спойлера: 0 — основной (тёмный у лезвия, в цвет у крыла), 1 — trim, 2 — dark
    wing = spec.get('spoiler', {}).get('style') == 'wing'
    objs['spoiler'] = obj('spoiler', spoiler(body, spec), [mats['paint'] if wing else mats['dark'],
                                                           mats['trim'], mats['dark']])
    objs['exhaust'] = obj('exhaust', exhaust(body, spec), [mats['chrome']])
    objs['interior_low'] = obj('interior_low', interior(body), [mats['interior']])
    # Подъёмные фары: начало узла — на петле (задняя кромка крышки), ось вращения — X
    for name, (pbm, cx, uh) in parts.get('popups', {}).items():
        hinge = Vector((0.0, body.y(uh), body.hit((cx, body.y(uh), 10.0), (0, 0, -1))[0].z))
        bmesh.ops.translate(pbm, verts=pbm.verts, vec=-hinge)
        o = obj(name, pbm, body_mats + [mats['headlight']])
        o.location = hinge
        # пустой узел петли: у пустых узлов сжатие meshopt не сдвигает начало координат
        scene.empty(f'hinge_{name}', root, hinge)

    # Колёса из библиотеки (утверждённые диски), масштаб под диаметр машины
    k = s.R / (common['tire']['outerDiameter'] / 2)
    for tag in ('FL', 'FR', 'RL', 'RR'):
        front = tag[0] == 'F'
        left = tag[1] == 'L'
        x = (-1 if left else 1) * s.track['front' if front else 'rear'] / 2
        y = body.y(s.u_front if front else s.u_rear)
        for lod in ('', '_LOD1', '_LOD2'):
            w, b = wheelgen.build_wheel(wspec, common, spec['wheels']['inches'], lod, root, wmats)
            for o, base in ((w, 'wheel'), (b, 'brake')):
                o.name = f'{base}_{tag}{lod}'
                if o.type == 'MESH':
                    o.data.name = o.name
                o.scale = (-k if left else k, k, k)  # левые — зеркально (суппорт остаётся сзади)
                o.location = (x, y, s.R)
    # Сокеты
    _, su0, su1 = spoiler_mount(body, spec)
    scene.empty('socket_spoiler', root, (0, body.y((su0 + su1) / 2), s.top((su0 + su1) / 2) + 0.01))
    scene.empty('socket_exhaust', root, (0, body.y(1.0), s.bottom_raw(0.99) + 0.075))
    scene.empty('socket_plate_front', root, (0, body.y(0.0), s.spec['face']['grille']['h'] * s.H))
    scene.empty('socket_plate_rear', root, (0, body.y(1.0), spec['rear'].get('plateH', 0.42 / s.H) * s.H + 0.06))
    return root
