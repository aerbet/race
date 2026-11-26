"""Кузовные киты (BLENDER_PLAN 5.4): «Уличный», «Трековый», «Дрифт».

Кит заменяет hood, bumper_front, bumper_rear, skirts, spoiler; body не меняется.
Детали строятся от той же поверхности кузова (Body.hit — луч на лофт), поэтому
прилегают без щелей: каждая накладка заходит под обшивку на 1–2 см.

Узлы кита в glTF: <часть>__<кит> (+ _LOD1/_LOD2) под пустым kit_<кит>; начало —
то же, что у car_root. Спойлер стоит в точке socket_spoiler (его начало = сокет),
клиент вешает его на сокет базовой модели.

Материалы кита: <имя>__<кит> — свой атлас uv0 и свой запечённый AO.
Слоты: 0 paint, 1 trim, 2 dark, 3 carbon, 4 accent (маска покраски: R — paint,
G — accent, B — carbon/хром).
"""

import math
import os

import bmesh
import bpy
from mathutils import Vector

from cars.body import Body
from cars.car import _add_bm, extrude_profile, slab, slab_grid
from lib import bake, lod, materials, scene, uv

KIT_PARTS = ('hood', 'bumper_front', 'bumper_rear', 'skirts', 'spoiler')
PAINTED_SLOTS = ('paint', 'accent')
P, TRIM, DARK, CARBON, ACCENT = range(5)


def kit_mats(kid, spec, kit):
    paint = spec['paint']['default']
    acc = kit.get('accent', '#d8202a')
    return [
        materials.pbr(f'paint__{kid}', paint, metallic=0.6, roughness=0.25),
        materials.pbr(f'trim__{kid}', '#1a1c22', metallic=0.4, roughness=0.45),
        materials.pbr(f'dark__{kid}', '#0c0d10', roughness=0.7),
        materials.pbr(f'carbon__{kid}', '#17181c', metallic=0.35, roughness=0.3),
        materials.pbr(f'accent__{kid}', acc, metallic=0.3, roughness=0.3),
    ]


# ---------------- геометрия ----------------

def ribbon(rings, mat, bm=None):
    """Кольца одинаковой длины → замкнутая труба с торцами."""
    bm = bm or bmesh.new()
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    fs = []
    for i in range(len(vs) - 1):
        for j in range(n):
            j2 = (j + 1) % n
            fs.append(bm.faces.new((vs[i][j], vs[i][j2], vs[i + 1][j2], vs[i + 1][j])))
    fs.append(bm.faces.new(vs[0][::-1]))
    fs.append(bm.faces.new(vs[-1]))
    for f in fs:
        f.material_index = mat
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return bm


class Anchors:
    """Опорные точки на поверхности кузова (лучом на лофт)."""

    def __init__(self, body):
        self.b = body
        self.s = body.s

    def under(self, x, u):
        loc, _ = self.b.hit((x, self.b.y(u), -1.0), (0, 0, 1))
        return loc.z if loc else self.s.bottom_raw(u)

    def front(self, x, z):
        loc, _ = self.b.hit((x, 10.0, z), (0, -1, 0))
        return loc.y if loc else None

    def rear(self, x, z):
        loc, _ = self.b.hit((x, -10.0, z), (0, 1, 0))
        return loc.y if loc else None

    def side(self, sgn, y, z):
        loc, _ = self.b.hit((sgn * 10.0, y, z), (-sgn, 0, 0))
        return abs(loc.x) if loc else None

    def top(self, x, u):
        loc, _ = self.b.hit((x, self.b.y(u), 10.0), (0, 0, -1))
        return loc.z if loc else self.s.top(u)


def taper(x, a, k=6, floor=0.25):
    return max((1 - min(abs(x) / a, 1) ** k) ** 0.5, floor)


def end_lip(an, prof, end='front', frac=0.86, n=28, mat=P, u_ref=None, flat_z=None):
    """Накладка вдоль ширины носа или кормы.

    prof(w, zu) → список (d, z): d — вынос наружу от поверхности (м), z — абсолютная высота;
    zu — низ кузова в этой точке. w — сужение к краям (1 в центре).
    """
    s = an.s
    u_ref = u_ref if u_ref is not None else (0.035 if end == 'front' else 0.972)
    a = s.half_width(0.03 if end == 'front' else 0.97) * frac
    rings = []
    for k in range(n + 1):
        x = -a + 2 * a * k / n
        zu = an.under(x, u_ref)
        zh = (flat_z if flat_z is not None else zu) + 0.03
        y0 = an.front(x, zh) if end == 'front' else an.rear(x, zh)
        if y0 is None:
            continue
        sg = 1 if end == 'front' else -1
        rings.append([(x, y0 + sg * d, z) for d, z in prof(taper(x, a), zu)])
    return ribbon(rings, mat) if len(rings) > 1 else bmesh.new()


def side_strip(an, prof, mat=P, steps=18):
    """Накладка вдоль порога между арками, обе стороны. prof → (dx наружу, z)."""
    s, b = an.s, an.b
    u0 = s.u_front + s.arch['front']['radius'] / s.L + 0.008
    u1 = s.u_rear - s.arch['rear']['radius'] / s.L - 0.008
    bm = bmesh.new()
    for sgn in (-1, 1):
        rings = []
        for k in range(steps + 1):
            u = u0 + (u1 - u0) * k / steps
            y = b.y(u)
            xs = an.side(sgn, y, 0.2) or s.half_width(u)
            rings.append([(sgn * (xs + dx), y, z) for dx, z in prof])
        ribbon(rings, mat, bm)
    return bm


def overfenders(an, mat=TRIM, out=0.06):
    """Накладные расширители арок (дрифт): дуга вокруг арки + вертикальные хвосты до порога."""
    s, b = an.s, an.b
    bm = bmesh.new()
    prof = [(-0.015, 0.09), (0.03, 0.085), (out, 0.02), (out - 0.005, -0.004), (-0.015, -0.002)]
    for axle, uc in (('front', s.u_front), ('rear', s.u_rear)):
        r = s.arch[axle]['radius']
        yc, zc = b.y(uc), s.R
        path = [((yc + r, 0.21), (1, 0)), ((yc + r, 0.27), (1, 0))]
        for k in range(1, 22):
            th = math.pi * k / 22
            path.append(((yc + r * math.cos(th), zc + r * math.sin(th)), (math.cos(th), math.sin(th))))
        path += [((yc - r, 0.27), (-1, 0)), ((yc - r, 0.21), (-1, 0))]
        for sgn in (-1, 1):
            rings, last = [], None
            for (py, pz), (ny, nz) in path:
                xs = an.side(sgn, py + ny * 0.03, pz + nz * 0.03) or last or s.half_width(uc)
                last = xs
                rings.append([(sgn * (xs + dx), py + ny * dr, pz + nz * dr) for dx, dr in prof])
            ribbon(rings, mat, bm)
    return bm


def canards(an, z, mat=CARBON):
    """Клыки на углах переднего бампера: тонкие пластины с наклоном."""
    bm = bmesh.new()
    for sgn in (-1, 1):
        rings = []
        x0, x1 = 0.56, 0.8
        for k in range(7):
            x = x0 + (x1 - x0) * k / 6
            y0 = an.front(sgn * x, z)
            if y0 is None:
                continue
            ext = 0.012 + 0.06 * k / 6
            rings.append([(sgn * x, y0 + d, z + 0.22 * d + dz) for d, dz in
                          ((-0.03, 0.0), (ext, 0.0), (ext, 0.007), (-0.03, 0.007))])
        if len(rings) > 1:
            ribbon(rings, mat, bm)
    return bm


def louvred_vents(body, mat_v=DARK, mat_l=TRIM, x0=0.24, x1=0.46, u0=0.1, u1=0.19, n=5):
    """Вентиляция капота с ламелями (вид сверху: (x, u))."""
    bm = bmesh.new()
    for sgn in (-1, 1):
        xa, xb = sorted((sgn * x0, sgn * x1))
        b = slab_grid(body, [(xa, u0), (xb, u0), (xb, u1), (xa, u1)], 'top', 0.002, 0.02, mat_v, nu=4, nv=3)
        if b:
            _add_bm(bm, b)
        for k in range(n):
            uu = u0 + (u1 - u0) * (k + 0.5) / n
            b = slab(body, [(xa + 0.01, uu - 0.004), (xb - 0.01, uu - 0.004), (xb - 0.01, uu + 0.004),
                            (xa + 0.01, uu + 0.004)], 'top', 0.007, 0.004, mat_l)
            if b:
                _add_bm(bm, b)
    return bm


def ducktail(body, h, ext, x_frac=0.9):
    """Хвост на кромке крышки багажника: высота h, вынос назад ext."""
    s = body.s
    u0, u1 = 0.958, 0.994
    a = s.half_width(0.96) * x_frac
    y0, y1 = body.y(u0), body.y(u1)
    z0, z1 = s.top(u0), s.top(u1)
    prof = [(y0, z0 - 0.004), (y1, z1 - 0.01), (y1 - ext, z1 + h), (y1 - ext + 0.03, z1 + h - 0.012),
            (y0 + 0.02, z0 + 0.006)]
    return extrude_profile(prof, -a, a, P)


def gt_wing(body, an, span=0.725, rise=0.26, chord=0.3):
    s = body.s
    bm = bmesh.new()
    yw = body.y(0.982)
    zw = s.top(0.95) + rise
    c = chord / 2
    foil = [(yw + c, zw), (yw + c * 0.6, zw + 0.024), (yw, zw + 0.032), (yw - c, zw + 0.05),
            (yw - c, zw + 0.04), (yw, zw + 0.006), (yw + c * 0.6, zw - 0.008)]
    _add_bm(bm, extrude_profile(foil, -span, span, CARBON))
    for sgn in (-1, 1):
        # торцевые пластины
        plate = [(yw + c + 0.03, zw - 0.06), (yw - c - 0.04, zw - 0.04), (yw - c - 0.04, zw + 0.1),
                 (yw + c - 0.02, zw + 0.07)]
        xa, xb = sorted((sgn * (span - 0.004), sgn * (span + 0.008)))
        _add_bm(bm, extrude_profile(plate, xa, xb, ACCENT))
        # стойки: от крышки багажника до крыла
        xs = sgn * 0.38
        ya, yb = body.y(0.93), body.y(0.968)
        za, zb = an.top(xs, 0.93) - 0.012, an.top(xs, 0.968) - 0.012
        post = [(ya, za), (yb, zb), (yw - 0.02, zw + 0.01), (yw + 0.07, zw + 0.012)]
        xa, xb = sorted((xs - 0.006, xs + 0.006))
        _add_bm(bm, extrude_profile(post, xa, xb, DARK))
    return bm


def diffuser(an, mat=CARBON):
    """Большой диффузор: наклонная плоскость под кормой + 5 рёбер."""
    s = an.s
    zin = s.clear + 0.04
    zc = an.under(0.0, 0.972)
    zout = zc - 0.005
    bm = end_lip(an, lambda w, zu: [(-0.32, zin), (0.07 * w, zout), (0.07 * w, zout + 0.01), (-0.32, zin + 0.01)],
                 end='rear', frac=0.7, mat=mat, flat_z=zc)
    for x in (-0.5, -0.32, 0.0, 0.32, 0.5):
        yr = an.rear(x, zc + 0.03)
        if yr is None:
            continue
        prof = [(yr + 0.25, zin + 0.006), (yr - 0.07, zout + 0.006), (yr - 0.07, zout + 0.095),
                (yr + 0.05, zc + 0.06)]
        _add_bm(bm, extrude_profile(prof, x - 0.005, x + 0.005, mat))
    return bm


# ---------------- киты ----------------

def _copy(name):
    """bmesh стоковой детали (LOD0) базовой модели."""
    bm = bmesh.new()
    bm.from_mesh(bpy.data.objects[name].data)
    return bm


def street(body, an):
    lip = end_lip(an, lambda w, zu: [(-0.12, zu + 0.015), (0.035 * w, zu - 0.012), (0.038 * w, zu - 0.002),
                                      (-0.005, zu + 0.03)])
    front = _copy('bumper_front')
    _add_bm(front, lip)
    rear = _copy('bumper_rear')
    _add_bm(rear, end_lip(an, lambda w, zu: [(-0.1, zu + 0.02), (0.02 * w, zu - 0.012), (0.024 * w, zu),
                                              (-0.005, zu + 0.035)], end='rear'))
    skirts = side_strip(an, [(-0.012, 0.135), (0.022, 0.132), (0.03, 0.19), (-0.012, 0.24)])
    return {'hood': _copy('hood'), 'bumper_front': front, 'bumper_rear': rear, 'skirts': skirts,
            'spoiler': ducktail(body, 0.022, 0.004)}


def track(body, an):
    zc = an.under(0.0, 0.035)
    zp = zc - 0.012
    front = _copy('bumper_front')
    _add_bm(front, end_lip(an, lambda w, zu: [(-0.3, zp), (0.09 * w, zp), (0.09 * w, zp + 0.01), (-0.3, zp + 0.01)],
                           frac=0.92, mat=CARBON, flat_z=zc))
    _add_bm(front, end_lip(an, lambda w, zu: [(-0.09, zp + 0.008), (0.01, zp + 0.008), (-0.004, zu + 0.03),
                                               (-0.09, zu + 0.03)], frac=0.9, mat=DARK))
    _add_bm(front, canards(an, 0.33))
    rear = _copy('bumper_rear')
    _add_bm(rear, diffuser(an))
    skirts = _copy('skirts')
    _add_bm(skirts, side_strip(an, [(-0.01, 0.124), (0.055, 0.12), (0.058, 0.128), (-0.01, 0.15)], mat=CARBON))
    hood = _copy('hood')
    _add_bm(hood, louvred_vents(body))
    return {'hood': hood, 'bumper_front': front, 'bumper_rear': rear, 'skirts': skirts,
            'spoiler': gt_wing(body, an)}


def drift(body, an):
    front = _copy('bumper_front')
    _add_bm(front, end_lip(an, lambda w, zu: [(-0.13, zu + 0.015), (0.07 * w, zu - 0.022), (0.075 * w, zu - 0.008),
                                               (-0.005, zu + 0.03)], frac=0.9))
    _add_bm(front, end_lip(an, lambda w, zu: [(-0.13, zu - 0.0), (0.08 * w, zu - 0.03), (0.08 * w, zu - 0.025),
                                               (-0.13, zu + 0.006)], frac=0.84, mat=DARK))
    rear = _copy('bumper_rear')
    _add_bm(rear, end_lip(an, lambda w, zu: [(-0.12, zu + 0.02), (0.035 * w, zu - 0.02), (0.04 * w, zu - 0.005),
                                              (-0.005, zu + 0.035)], end='rear', frac=0.9))
    skirts = side_strip(an, [(-0.012, 0.13), (0.05, 0.128), (0.055, 0.2), (-0.012, 0.26)])
    _add_bm(skirts, overfenders(an))
    hood = _copy('hood')
    # Карбоновый капот: окрашенные грани стокового капота → карбон (без накладки — нет просветов)
    for f in hood.faces:
        if f.material_index == P:
            f.material_index = CARBON
    for sgn in (-1, 1):  # замки капота
        x = sgn * 0.5
        z = an.top(x, 0.09)
        y = body.y(0.09)
        b = bmesh.new()
        bmesh.ops.create_cone(b, cap_ends=True, segments=10, radius1=0.016, radius2=0.016, depth=0.016)
        bmesh.ops.translate(b, verts=b.verts, vec=(x, y, z + 0.004))
        for f in b.faces:
            f.material_index = TRIM
        _add_bm(hood, b)
    return {'hood': hood, 'bumper_front': front, 'bumper_rear': rear, 'skirts': skirts,
            'spoiler': ducktail(body, 0.075, 0.035, 0.93)}


BUILDERS = {'street': street, 'track': track, 'drift': drift}


def _weld(bm):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)


def build_kits(spec, car_root):
    """Построить все киты спецификации. Возвращает {kid: kit_root}."""
    body = Body(spec)
    body.build()[0].free()
    an = Anchors(body)
    sock = bpy.data.objects['socket_spoiler'].location.copy()
    out = {}
    for kid, kit in spec.get('kits', {}).items():
        mats = kit_mats(kid, spec, kit)
        root = scene.empty(f'kit_{kid}', display='ARROWS', size=0.3)
        parts = BUILDERS[kid](body, an)
        for name in KIT_PARTS:
            bm = parts[name]
            _weld(bm)
            if name == 'spoiler':
                bmesh.ops.translate(bm, verts=bm.verts, vec=-sock)
            o = scene.mesh_object(f'{name}__{kid}', bm, root, mats)
            if name == 'spoiler':
                o.location = sock
        # Сокет спойлера в ките: клиент совмещает его с socket_spoiler базовой модели
        scene.empty(f'socket_spoiler__{kid}', root, sock)
        out[kid] = root
    return out


def kit_objects(root, level=0):
    suf = ('', '_LOD1', '_LOD2')[level]
    return [o for o in root.children if o.type == 'MESH' and
            (o.name.endswith(suf) if level else '_LOD' not in o.name)]


def finish_kits(kit_roots, spec, export_dir, ao=True):
    """Сглаживание, uv0, AO, LOD и экспорт каждого кита в kit_<kid>.glb."""
    stock = [bpy.data.objects[n] for n in KIT_PARTS]
    paths = {}
    for kid, root in kit_roots.items():
        objs = kit_objects(root)
        scene.select_only(objs)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32))
        uv.smart_uv0(objs)
        if ao:
            # Затенение от кузова считается, стоковые детали и другие киты скрыты
            # (и все LOD1/LOD2 — они почти совпадают с LOD0 и дали бы ложное затенение)
            hidden = stock + [o for k, r in kit_roots.items() if k != kid for o in r.children]
            hidden += [o for o in bpy.data.objects if '_LOD' in o.name and o not in hidden]
            for o in hidden:
                o.hide_render = True
            mats = {m for o in objs for m in o.data.materials if m.name.split('__')[0] in ('paint', 'accent', 'carbon')}
            bake.bake_ao(objs, mats, size=512, samples=48, name=f'ao_kit_{kid}',
                         path=os.path.join(export_dir, f'ao_kit_{kid}.jpg'))
            for o in hidden:
                o.hide_render = False
        lod.make_lods(root)
        from lib import export
        paths[kid] = export.glb(root, os.path.join(export_dir, f'kit_{kid}.glb'))
    return paths


def show_variant(car_root, kit_roots, kid):
    """Для рендеров: база с китом kid (None — сток); только LOD0."""
    for o in KIT_PARTS:
        bpy.data.objects[o].hide_render = kid is not None
    for k, r in kit_roots.items():
        for o in r.children:
            o.hide_render = not (k == kid and '_LOD' not in o.name)


def render_kits(car_root, kit_roots, out):
    """kits.png (3/4 спереди) и kits_rear.png (3/4 сзади): сетка 2×2 — сток и три кита."""
    from lib import render
    render.show_lod(car_root, 0)
    lo, hi = render.bbox(render._lod_objs(car_root, 0))
    c = (lo + hi) / 2
    r = (hi - lo).length
    temp = render._studio()
    cam = render._camera()
    cam.data.type = 'PERSP'
    cam.data.lens = 50
    render._setup('CYCLES', 48)
    sheets = []
    for sheet, dirv in (('kits', (0.8, 0.8, 0.28)), ('kits_rear', (-0.8, -0.8, 0.3))):
        files = []
        for kid in (None, *kit_roots):
            show_variant(car_root, kit_roots, kid)
            render._aim(cam, c + Vector(dirv).normalized() * r * 1.45, c)
            files.append(render._render(os.path.join(out, f'{sheet}_{kid or "stock"}.png')))
        sheets.append(render.compose(files, os.path.join(out, f'{sheet}.png'), cols=2, tile=768))
    show_variant(car_root, kit_roots, None)
    for r_ in kit_roots.values():
        for o in r_.children:
            o.hide_render = True
    render._temp(temp)
    return sheets
