"""Оформление трасс (BLENDER_PLAN 7.1): библиотека элементов с одним атласом 1024².

Запуск: pnpm art:track dressing → apps/client/public/tracks/dressing.glb + dressing.json
Элемент: начало — на земле у кромки дороги, X — вдоль дороги, −Y — к дороге (в сцене +Z), Z — вверх.
Игра расставляет элементы вдоль сплайна по правилам (packages/shared/src/tracks/dressing.ts).
Логотипы спонсоров — вымышленные фигуры без текста; название гонки на арке — узор-шевроны.
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

N = 1024
C = 256  # ячейка атласа 4×4
CELLS = ['concrete', 'stripes', 'rubber', 'metal', 'fence', 'seats', 'cone', 'lamp',
         'logo_a', 'logo_b', 'logo_c', 'logo_d', 'arch', 'asphalt', 'pine', 'rock']
EMISSIVE = {'lamp', 'logo_a', 'logo_b', 'logo_c', 'logo_d', 'arch'}


def cell_uv(name, inset=0.06):
    i = CELLS.index(name)
    cx, cy = i % 4, 3 - i // 4  # строки сверху вниз → v снизу вверх
    e = inset / 4
    return cx / 4 + e, cy / 4 + e, (cx + 1) / 4 - e, (cy + 1) / 4 - e


def _rgb(h):
    return np.array([int(h.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def atlas(seed=5):
    rng = np.random.default_rng(seed)
    img = np.zeros((N, N, 3))
    emi = np.zeros((N, N, 3))
    yy, xx = np.mgrid[0:C, 0:C] / C

    def put(name, a, e=None):
        i = CELLS.index(name)
        r, c = i // 4, i % 4
        img[r * C:(r + 1) * C, c * C:(c + 1) * C] = np.clip(a, 0, 1)
        if e is not None:
            emi[r * C:(r + 1) * C, c * C:(c + 1) * C] = np.clip(e, 0, 1)

    def noise(amp, scale=16):
        g = rng.random((C // scale + 2, C // scale + 2))
        g = np.kron(g, np.ones((scale, scale)))[:C, :C]
        return (g - 0.5) * amp

    put('concrete', np.ones((C, C, 3)) * _rgb('#8e8e8a') + noise(0.12)[..., None])
    stripes = np.where(((xx * 4).astype(int) % 2) == 0, 1.0, 0.0)[..., None]
    put('stripes', stripes * _rgb('#e8e8e8') + (1 - stripes) * _rgb('#1e5bd6'))  # бело-синие (не «фирменные» красно-белые)
    tyre = np.ones((C, C, 3)) * _rgb('#141416') + noise(0.04, 4)[..., None]
    tyre[(yy * 8 % 1) < 0.08] *= 0.5
    put('rubber', tyre)
    put('metal', np.ones((C, C, 3)) * _rgb('#a9b0b8') * (0.85 + 0.3 * yy[..., None]) + noise(0.05)[..., None])
    grid = (((xx * 24) % 1) < 0.12) | (((yy * 24) % 1) < 0.12)
    put('fence', np.where(grid[..., None], _rgb('#6c7078'), _rgb('#15171c')))
    seats = np.ones((C, C, 3)) * _rgb('#2453a8')
    seats[((yy * 10) % 1) > 0.75] = _rgb('#0f1422')
    seats[((xx * 16) % 1) < 0.06] *= 0.6
    put('seats', seats)
    cone = np.ones((C, C, 3)) * _rgb('#ff6a13')
    cone[(yy > 0.35) & (yy < 0.55)] = _rgb('#f2f2f2')
    put('cone', cone)
    lamp = np.ones((C, C, 3)) * _rgb('#fff6e0')
    put('lamp', lamp, lamp)
    # Вымышленные спонсоры: фигуры на тёмном поле, без надписей
    logos = {
        'logo_a': ('#ff2bd6', lambda: (np.hypot(xx - 0.3, yy - 0.5) < 0.18) | ((xx > 0.5) & (xx < 0.9) & (abs(yy - 0.5) < 0.07))),
        'logo_b': ('#29e0ff', lambda: (abs(yy - 0.5) < 0.3) & (abs(xx - 0.5) < 0.35) & (abs((xx - 0.5) * 1.5 + (yy - 0.5)) < 0.12)),
        'logo_c': ('#8cff3a', lambda: ((xx - 0.15) % 0.25 < 0.1) & (abs(yy - 0.5) < 0.25 - abs(((xx - 0.15) % 0.25) - 0.05))),
        'logo_d': ('#ffb02b', lambda: (np.hypot(xx - 0.5, yy - 0.5) < 0.3) & (np.hypot(xx - 0.6, yy - 0.45) > 0.2)),
    }
    for name, (col, shape) in logos.items():
        a = np.ones((C, C, 3)) * _rgb('#101218')
        m = shape()
        a[m] = _rgb(col)
        a[(yy < 0.06) | (yy > 0.94)] = _rgb(col) * 0.7  # рамка-полоса
        e = np.zeros_like(a)
        e[m] = _rgb(col)
        e[(yy < 0.06) | (yy > 0.94)] = _rgb(col) * 0.6
        put(name, a, e)
    arch = np.ones((C, C, 3)) * _rgb('#0e1016')
    chev = (abs(((xx * 6) % 1) - 0.5) * 1.2 + abs(yy - 0.5)) % 0.5 < 0.12
    arch[chev] = _rgb('#29e0ff')
    e = np.zeros_like(arch)
    e[chev] = _rgb('#29e0ff')
    put('arch', arch, e)
    put('asphalt', np.ones((C, C, 3)) * _rgb('#2a2b30') + noise(0.06, 4)[..., None])
    pine = np.ones((C, C, 3)) * _rgb('#1d3a26') + noise(0.1, 8)[..., None]
    put('pine', pine)
    put('rock', np.ones((C, C, 3)) * _rgb('#6d6a66') + noise(0.18, 8)[..., None] + noise(0.08, 2)[..., None])
    return img, emi


class Mesh:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('uv0')

    def quad(self, pts, cell, uvs=None):
        u0, v0, u1, v1 = cell_uv(cell)
        uvs = uvs or [(0, 0), (1, 0), (1, 1), (0, 1)]
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        for loop, (a, b) in zip(f.loops, uvs):
            loop[self.uv].uv = (u0 + (u1 - u0) * a, v0 + (v1 - v0) * b)

    def box(self, x0, x1, y0, y1, z0, z1, cell, top=True):
        ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        for i in range(4):
            (ax, ay), (bx, by) = ring[i], ring[(i + 1) % 4]
            self.quad([(ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1)], cell)
        if top:
            self.quad([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], cell)

    def lathe(self, prof, seg, cx, cy, cell):
        rings = [[self.bm.verts.new((cx + r * math.cos(2 * math.pi * k / seg), cy + r * math.sin(2 * math.pi * k / seg), z))
                  for k in range(seg)] for r, z in prof]
        u0, v0, u1, v1 = cell_uv(cell)
        for i in range(len(rings) - 1):
            for k in range(seg):
                k2 = (k + 1) % seg
                f = self.bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
                for loop, (a, b) in zip(f.loops, ((k, i), (k + 1, i), (k + 1, i + 1), (k, i + 1))):
                    loop[self.uv].uv = (u0 + (u1 - u0) * a / seg, v0 + (v1 - v0) * b / (len(rings) - 1))

    def finish(self):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        return self.bm


# ---- элементы (длина вдоль X — шаг расстановки) ----

def concrete_block(m):
    m.box(-1.0, 1.0, -0.3, 0.3, 0, 0.8, 'concrete')
    m.box(-1.0, 1.0, -0.31, -0.3, 0.55, 0.8, 'stripes', top=False)


def guardrail(m):
    for x in (-1.8, 0.2):
        m.box(x - 0.06, x + 0.06, -0.06, 0.06, 0, 0.75, 'metal')
    m.box(-2.0, 2.0, -0.12, -0.06, 0.45, 0.75, 'metal')


def tire_wall(m):
    for row in range(3):
        for k in range(5):
            m.lathe([(0.33, row * 0.25), (0.33, row * 0.25 + 0.24)], 10, -1.6 + k * 0.8 + (row % 2) * 0.4 - 0.2, 0, 'rubber')
    m.box(-2.0, 2.0, -0.36, -0.34, 0.2, 0.55, 'stripes', top=False)


def fence(m):
    for x in (-2.0, 2.0):
        m.box(x - 0.05, x + 0.05, 0.3, 0.4, 0, 3.0, 'metal')
    m.quad([(-2, 0.35, 0.2), (2, 0.35, 0.2), (2, 0.35, 3.0), (-2, 0.35, 3.0)], 'fence')
    m.quad([(2, 0.351, 0.2), (-2, 0.351, 0.2), (-2, 0.351, 3.0), (2, 0.351, 3.0)], 'fence')


def grandstand(m):
    for k in range(8):  # ступени
        m.box(-10, 10, 2 + k * 0.8, 2 + (k + 1) * 0.8, 0, 0.6 + k * 0.55, 'seats')
    m.box(-10.2, 10.2, 1.8, 9, 6.0, 6.3, 'metal')  # навес
    for x in (-10, 0, 10):
        m.box(x - 0.15, x + 0.15, 8.6, 8.9, 0, 6.0, 'metal')


def banner(logo):
    def gen(m):
        for x in (-2.9, 2.9):
            m.box(x - 0.06, x + 0.06, 0.4, 0.5, 0, 2.6, 'metal')
        m.quad([(-3, 0.39, 1.0), (3, 0.39, 1.0), (3, 0.39, 2.4), (-3, 0.39, 2.4)], logo)
    return gen


def cone(m):
    m.lathe([(0.2, 0.0), (0.2, 0.03), (0.15, 0.06), (0.03, 0.7)], 10, 0, 0, 'cone')


def light_mast(m):
    m.lathe([(0.25, 0), (0.12, 18)], 8, 0, 1.0, 'metal')
    m.box(-1.6, 1.6, 0.2, 1.2, 18, 19.2, 'metal')
    m.quad([(-1.5, 0.19, 18.1), (1.5, 0.19, 18.1), (1.5, 0.19, 19.1), (-1.5, 0.19, 19.1)], 'lamp')


def start_arch(m):
    """Арка старта/финиша на 24 м (клиент масштабирует по ширине трассы)."""
    for x in (-12.5, 12.5):
        m.box(x - 0.7, x + 0.7, -0.7, 0.7, 0, 7.5, 'metal')
    m.box(-13.2, 13.2, -0.8, 0.8, 7.5, 9.6, 'metal')
    m.quad([(-12, -0.81, 7.7), (12, -0.81, 7.7), (12, -0.81, 9.4), (-12, -0.81, 9.4)], 'arch',
           [(0, 0), (4, 0), (4, 1), (0, 1)])
    m.quad([(12, 0.81, 7.7), (-12, 0.81, 7.7), (-12, 0.81, 9.4), (12, 0.81, 9.4)], 'arch')


def tunnel(m):
    """Секция тоннеля 12 м поперёк дороги шириной до 16 м (стены и свод)."""
    w, h = 9.0, 7.0
    for side in (-1, 1):
        m.box(-6, 6, side * w - 0.4, side * w + 0.4, 0, h, 'concrete')
    m.box(-6, 6, -w - 0.4, w + 0.4, h, h + 0.6, 'concrete')
    for x in (-3, 3):
        m.quad([(x - 1, -0.6, h - 0.01), (x + 1, -0.6, h - 0.01), (x + 1, 0.6, h - 0.01), (x - 1, 0.6, h - 0.01)][::-1], 'lamp')


def pine(m):
    m.lathe([(0.25, 0), (0.18, 2.0)], 6, 0, 0, 'rock')
    for k, (r, z0, z1) in enumerate(((2.4, 1.5, 5.0), (1.8, 4.0, 7.2), (1.1, 6.2, 9.0))):
        m.lathe([(r, z0), (0.05, z1)], 7, 0, 0, 'pine')


def rock(m):
    m.lathe([(2.2, -0.4), (2.4, 0.6), (1.8, 1.6), (0.9, 2.3), (0.1, 2.5)], 7, 0, 0, 'rock')


def rock_b(m):
    m.lathe([(3.4, -0.5), (3.0, 1.0), (2.2, 2.2), (0.6, 3.2), (0.1, 3.3)], 6, 0, 0, 'rock')


ITEMS = [
    # id, генератор, шаг вдоль дороги (м) — длина элемента
    ('concrete_block', concrete_block, 2.0),
    ('guardrail', guardrail, 4.0),
    ('tire_wall', tire_wall, 4.0),
    ('fence', fence, 4.0),
    ('grandstand', grandstand, 20.4),
    ('banner_a', banner('logo_a'), 6.0),
    ('banner_b', banner('logo_b'), 6.0),
    ('banner_c', banner('logo_c'), 6.0),
    ('banner_d', banner('logo_d'), 6.0),
    ('cone', cone, 0.4),
    ('light_mast', light_mast, 3.2),
    ('start_arch', start_arch, 2.0),
    ('tunnel', tunnel, 12.0),
    ('pine', pine, 4.8),
    ('rock', rock, 4.8),
    ('rock_b', rock_b, 6.8),
]


def material(out):
    m = bpy.data.materials.new('dressing')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    for img_name, inp in (('dressing.jpg', 'Base Color'), ('dressing_emit.jpg', 'Emission Color')):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(out, img_name))
        nt.links.new(t.outputs['Color'], b.inputs[inp])
    b.inputs['Emission Strength'].default_value = 1.0
    b.inputs['Roughness'].default_value = 0.7
    return m


def main():
    out = os.path.join(scene.ART, 'export', 'tracks')
    os.makedirs(out, exist_ok=True)
    a, e = atlas()
    ts.save(a, os.path.join(out, 'dressing.jpg'), N)
    ts.save(e, os.path.join(out, 'dressing_emit.jpg'), 512)
    scene.reset()
    mat = material(out)
    root = scene.empty('dressing_root')
    cat = []
    for iid, gen, step in ITEMS:
        m = Mesh()
        gen(m)
        o = scene.mesh_object(iid, m.finish(), root, [mat])
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        cat.append({'id': iid, 'step': step, 'tris': tris})
        print(f'ITEM {iid}: {tris} тр.')
    export.glb(root, os.path.join(out, 'dressing.glb'))
    with open(os.path.join(out, 'dressing.json'), 'w', encoding='utf-8') as f:
        json.dump({'items': cat, 'cells': CELLS}, f, ensure_ascii=False, indent=1)
    scene.save_blend(os.path.join(scene.ART, 'source', 'tracks', 'dressing.blend'))


if __name__ == '__main__':
    main()
