"""Колёса (BLENDER_PLAN 5.3): 6 дисков по спецификациям × 2 диаметра.

Запуск (через `pnpm art:wheels`):
  blender -b --factory-startup -P art/scripts/cars/wheels.py -- [--only <id>] [--no-render]

Колесо: ось вращения — X Блендера (в игре тоже X), лицевая сторона диска — в +X
(правый борт; для левых колёс игра зеркалит по X). Начало координат — центр колеса.
Узлы glb: wheel_root → wheel (+_LOD1/_LOD2, вращается), brake (+_LOD1, не вращается).
LOD — не Decimate, а пересборка с меньшим числом сегментов: форма спиц сохраняется.
Шина — без надписей; рисунок протектора — карта нормалей, сгенерированная здесь же.
"""

import argparse
import glob
import json
import math
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from lib import checks, export, materials, render, scene  # noqa: E402

SPECS = os.path.join(scene.ART, 'specs', 'wheels')
INCH = 0.0254

FINISH = {
    'silver': ('#c4c8d0', 0.92, 0.25),
    'gunmetal': ('#4a4e55', 0.85, 0.32),
    'bronze': ('#a07a3a', 0.9, 0.3),
    'black': ('#15161a', 0.5, 0.3),
    'white': ('#e8e8ea', 0.0, 0.3),
    'chrome': ('#e0e3e8', 1.0, 0.07),
}

# Уровни детализации: сегменты по окружности, шаги вдоль спицы
LODS = {'': (36, 5), '_LOD1': (18, 3), '_LOD2': (10, 1)}


# ---------- геометрия ----------

def _bm_to_obj(name, bm, mats, parent):
    bm.normal_update()
    if bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    return scene.mesh_object(name, bm, parent, mats)


def lathe(bm, profile, seg, mat=0, uv=None):
    """Тело вращения вокруг X из замкнутого профиля [(x, r), ...]. Нормали — наружу.

    uv: (повторов по окружности, список v для точек профиля + замыкающая) — для шины.
    """
    n = len(profile)
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((x, r * ca, r * sa)) for x, r in profile])
    faces = []
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(n):
            j2 = (j + 1) % n
            f = bm.faces.new((rings[i][j], rings[i2][j], rings[i2][j2], rings[i][j2]))
            f.material_index = mat
            f.smooth = True  # тело вращения — гладкое по окружности
            faces.append((f, i, j))
    # Ориентация: нормаль грани у самой дальней от оси точки профиля должна смотреть от оси
    bm.normal_update()
    jmax = max(range(n), key=lambda j: profile[j][1])
    f0 = next(f for f, i, j in faces if i == 0 and j == jmax)
    c = f0.calc_center_median()
    if f0.normal.dot(Vector((0, c.y, c.z))) < 0:
        bmesh.ops.reverse_faces(bm, faces=[f for f, _, _ in faces])
    if uv:
        reps, vs = uv
        layer = bm.loops.layers.uv.get('uv0') or bm.loops.layers.uv.new('uv0')
        for f, i, j in faces:
            for loop in f.loops:
                vi = loop.vert
                # индекс кольца и точки профиля для вершины этой грани
                for ii in (i, (i + 1) % seg):
                    if vi in rings[ii]:
                        jj = rings[ii].index(vi)
                        uu = (ii if not (ii == 0 and i == seg - 1) else seg) / seg * reps
                        vv = vs[jj] if not (jj == 0 and j == n - 1) else vs[n]
                        loop[layer].uv = (uu, vv)
                        break
    return [f for f, _, _ in faces]


def tire_profile(ro, rr, w, steps):
    """Профиль шины (x, r): внутренний борт → беговая дорожка → наружный борт → посадка.

    Возвращает точки и v-координаты развёртки (длина дуги, 0..1).
    """
    h = ro - rr
    half = [
        (0.40, rr - 0.004), (0.47, rr + h * 0.2), (0.50, rr + h * 0.55),
        (0.47, ro - h * 0.1), (0.40, ro - 0.003), (0.33, ro),
    ]
    if steps < 3:
        half = [half[0], half[2], half[3], half[5]]
    tread = [(-0.11, ro), (0.0, ro), (0.11, ro)] if steps >= 3 else [(0.0, ro)]
    outer = [(-x * w, r) for x, r in half] + [(x * w, r) for x, r in tread] + \
            [(x * w, r) for x, r in reversed(half)]
    # Замыкаем через посадочную полку (внутренняя стенка шины — под ободом)
    pts = outer + [(half[0][0] * w * 0.5, rr - 0.006)]
    pts.reverse()
    pts = pts[1:] + pts[:1]
    lens = [0.0]
    for a, b in zip(pts, pts[1:] + pts[:1]):
        lens.append(lens[-1] + math.dist(a, b))
    vs = [s / lens[-1] for s in lens]
    return pts, vs


def tread_normal_map(name, size=(1024, 256), reps_per_tex=1):
    """Карта нормалей протектора: 3 продольные канавки + косые ламели и блоки плеч.

    По U — окружность (повторяется), по V — профиль шины (дуга); рисунок — только в
    зоне беговой дорожки. Без надписей.
    """
    w, h = size
    u = (np.arange(w) + 0.5) / w
    v = (np.arange(h) + 0.5) / h
    U, V = np.meshgrid(u, v)
    # Беговая дорожка в развёртке — середина дуги профиля (см. tire_profile)
    t0, t1 = 0.33, 0.67
    t = np.clip((V - t0) / (t1 - t0), 0, 1)
    inside = (V > t0) & (V < t1)
    height = np.ones_like(U)
    for g in (0.2, 0.5, 0.8):  # продольные канавки
        height -= 0.9 * np.exp(-((t - g) / 0.025) ** 2)
    blocks = 24
    phase = U * blocks + np.where(t < 0.5, t, 1 - t) * 1.6  # косые поперечные канавки
    lateral = np.exp(-((np.mod(phase, 1.0) - 0.5) / 0.05) ** 2)
    shoulder = (t < 0.2) | (t > 0.8)
    height -= np.where(shoulder, 0.8, 0.35) * lateral
    sipes = np.exp(-((np.mod(phase * 2 + 0.25, 1.0) - 0.5) / 0.02) ** 2)
    height -= np.where(shoulder, 0, 0.25) * sipes
    height = np.where(inside, height, 1.0)
    # Высота → нормаль (касательное пространство)
    k = 10.0
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * k
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * k * h / w
    nz = 1 / np.sqrt(dx * dx + dy * dy + 1)
    rgba = np.stack([(-dx * nz) * 0.5 + 0.5, (-dy * nz) * 0.5 + 0.5, nz * 0.5 + 0.5,
                     np.ones_like(nz)], axis=-1).astype(np.float32)
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = 'PNG'
    img.pack()
    return img


def tire_material(img):
    m = materials.pbr('tire', '#121315', roughness=0.9)
    nt = m.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.uv_map = 'uv0'
    nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], nt.nodes['Principled BSDF'].inputs['Normal'])
    return m


def spoke_outlines(spec, r0, r1, steps):
    """Контуры спиц в полярных координатах [(угол, радиус), ...] по стилю."""
    n = spec['spokes']
    sw = spec['spokeWidth']
    style = spec['style']
    out = []

    def strip(a_of_r, w0, w1):
        """Полоса вдоль радиуса: центр — угол a(r), ширина w0 у ступицы → w1 у обода."""
        rs = [r0 + (r1 - r0) * k / steps for k in range(steps + 1)]
        left, right = [], []
        for k, r in enumerate(rs):
            ww = w0 + (w1 - w0) * k / steps
            da = ww / 2 / r
            left.append((a_of_r(r) + da, r))
            right.append((a_of_r(r) - da, r))
        return left + right[::-1]

    for i in range(n):
        a = 2 * math.pi * i / n
        if style == 'straight':
            out.append(strip(lambda r, a=a: a, sw * 1.25, sw))
        elif style == 'double':
            gap = sw * 0.9
            for s in (-1, 1):
                out.append(strip(lambda r, a=a, s=s: a + s * (gap / 2 + sw / 2) / r * (0.35 + 0.65 * (r - r0) / (r1 - r0)),
                                 sw * 0.9, sw * 0.8))
        elif style == 'star':
            spread = math.radians(9)
            for s in (-1, 1):
                out.append(strip(lambda r, a=a, s=s: a + s * (sw * 0.22 / r + spread * ((r - r0) / (r1 - r0)) ** 1.4),
                                 sw * 0.8, sw * 0.7))
        elif style == 'mesh':
            twist = math.pi / n * 0.95
            for s in (-1, 1):
                out.append((strip(lambda r, a=a, s=s: a + s * twist * (r - r0) / (r1 - r0), sw, sw), s))
        elif style == 'turbine':
            curl = math.radians(38)
            out.append(strip(lambda r, a=a: a + curl * ((r - r0) / (r1 - r0)) ** 1.6, sw * 0.7, sw * 1.2))
    return out


def prism(bm, outline, x_of_r, thick, mat):
    """Плоский контур (угол, радиус) → замкнутая призма: лицо по x_of_r, толщина thick назад (−X)."""
    top = [bm.verts.new((x_of_r(r), r * math.cos(a), r * math.sin(a))) for a, r in outline]
    bot = [bm.verts.new((v.co.x - thick, v.co.y, v.co.z)) for v in top]
    n = len(top)
    faces = [bm.faces.new(top), bm.faces.new(bot[::-1])]
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((top[j], top[i], bot[i], bot[j])))
    for f in faces:
        f.material_index = mat
    faces[0].normal_update()
    if faces[0].normal.x < 0:  # лицо спицы должно смотреть наружу (+X)
        bmesh.ops.reverse_faces(bm, faces=faces)


def build_wheel(spec, common, inches, lod, parent, mats):
    seg, steps = LODS[lod]
    ro = common['tire']['outerDiameter'] / 2
    w = common['tire']['width']
    rr = inches * INCH / 2  # радиус посадочной полки обода
    xf = w * 0.40  # плоскость кромки обода (чуть внутри наружной боковины шины)

    # Шина
    pts, vs = tire_profile(ro, rr, w, steps)
    bm_t = bmesh.new()
    lathe(bm_t, pts, seg, mat=0, uv=(3, vs))  # 3 × 24 = 72 блока по окружности
    # Обод: кромка (полка) + бочка, замкнутый профиль
    lip_t = 0.012 if spec['lip'] != 'same' or spec['dish'] > 0.03 else 0.008
    back = -w * 0.46
    barrel = [
        (xf, rr + 0.014), (xf - 0.006, rr + 0.02), (xf - 0.014, rr + 0.004),
        (back + 0.01, rr + 0.002), (back, rr + 0.014), (back - 0.006, rr + 0.008),
        (back, rr - 0.008), (xf - lip_t - 0.004, rr - 0.01), (xf - 0.002, rr - 0.004),
    ]
    if steps < 3:
        barrel = [barrel[0], barrel[2], barrel[4], barrel[6], barrel[8]]
    bm = bmesh.new()
    lathe(bm, barrel, seg, mat=2)
    # Спицы
    dish, conc, thick = spec['dish'], spec['concave'], spec['thickness']
    hub_r = 0.075
    x_rim = xf - dish - 0.006
    x_hub = x_rim - conc
    r0, r1 = hub_r * 0.85, rr - 0.005

    def x_of_r(r, off=0.0):
        k = min(max((r - r0) / (r1 - r0), 0), 1)
        return x_hub + (x_rim - x_hub) * (k ** 0.8) + off

    # Сетка — вдвое больше спиц, поэтому вдоль спицы меньше шагов
    sst = max(1, steps - 2) if spec['style'] == 'mesh' else steps
    for item in spoke_outlines(spec, r0, r1, sst):
        if isinstance(item, tuple):  # сетка: два слоя, чтобы перекрестья не мерцали
            outline, s = item
            prism(bm, outline, lambda r, s=s: x_of_r(r, 0.003 if s > 0 else -0.003), thick, 1)
        else:
            prism(bm, item, x_of_r, thick, 1)
    # Ступица: шайба + колпачок
    hub = [(x_hub + 0.006, hub_r * 0.55), (x_hub + 0.004, hub_r), (x_hub - thick - 0.01, hub_r),
           (x_hub - thick - 0.01, hub_r * 0.5)]
    lathe(bm, hub, max(seg // 2, 8), mat=1)
    cap = [(x_hub + 0.016, 0.012), (x_hub + 0.014, 0.028), (x_hub + 0.002, 0.034), (x_hub + 0.002, 0.01)]
    lathe(bm, cap, max(seg // 2, 8), mat=2)
    # Гайки (на LOD2 нет)
    if lod != '_LOD2':
        nl = spec['lugs']
        for i in range(nl):
            a = 2 * math.pi * i / nl + math.pi / nl
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.009, radius2=0.008, depth=0.016)
            bmesh.ops.rotate(bm, verts=res['verts'], matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
            bmesh.ops.translate(bm, verts=res['verts'],
                                vec=(x_hub + 0.012, 0.05 * math.cos(a), 0.05 * math.sin(a)))
            for f in {f for v in res['verts'] for f in v.link_faces}:
                f.material_index = 3
    # Шина и диск — один меш «wheel» (вращается целиком): материалы tire, rim, rim_lip, lug
    me = bpy.data.meshes.new('_rim')
    bm.to_mesh(me)
    bm.free()
    bm_t.from_mesh(me)
    bpy.data.meshes.remove(me)
    wheel = _bm_to_obj(f'wheel{lod}', bm_t, [mats['tire'], mats['rim'], mats['rim_lip'], mats['lug']], parent)

    # Тормоз: диск + колокол + суппорт сзади-сверху (на LOD2 — нет)
    if lod == '_LOD2':
        return wheel, scene.empty('brake_LOD2', parent)
    x_back_spoke = x_hub - thick - 0.012
    xd = min(x_back_spoke - 0.03, xf - dish - thick - 0.04)
    rd = rr * 0.80
    bm = bmesh.new()
    disc = [(xd + 0.014, rd), (xd - 0.014, rd), (xd - 0.014, 0.09), (xd + 0.014, 0.09)]
    lathe(bm, disc, seg, mat=0)
    hat = [(xd + 0.014, 0.095), (x_back_spoke - 0.002, 0.08), (x_back_spoke - 0.002, 0.03), (xd + 0.014, 0.03)]
    lathe(bm, hat, max(seg // 2, 8), mat=0)
    # Суппорт: дуга сечением прямоугольник, охватывает диск
    a0, a1 = math.radians(110), math.radians(160)  # сзади (−Y) и сверху (+Z)
    arc = max(steps, 2) + 1
    ring = []
    for k in range(arc + 1):
        a = a0 + (a1 - a0) * k / arc
        ca, sa = math.cos(a), math.sin(a)
        ring.append([bm.verts.new((x, r * ca, r * sa)) for x, r in
                     ((xd + 0.03, rd + 0.012), (xd - 0.03, rd + 0.012), (xd - 0.03, rd - 0.05),
                      (xd + 0.03, rd - 0.05))])
    cf = []
    for k in range(arc):
        for j in range(4):
            cf.append(bm.faces.new((ring[k][j], ring[k][(j + 1) % 4], ring[k + 1][(j + 1) % 4], ring[k + 1][j])))
    cf.append(bm.faces.new(ring[0][::-1]))
    cf.append(bm.faces.new(ring[-1]))
    for f in cf:
        f.material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=cf)
    brake = scene.mesh_object(f'brake{lod}', bm, parent, [mats['brake_disc'], mats['caliper']])
    return wheel, brake


def wheel_materials(spec, common):
    col, met, rough = FINISH[spec['finish']]
    lip = spec['lip']
    lc, lm, lr = FINISH[lip] if lip != 'same' else (col, met, rough)
    return {
        'tire': tire_material(tread_normal_map('tire_tread_normal')),
        'rim': materials.pbr('rim', col, metallic=met, roughness=rough),
        'rim_lip': materials.pbr('rim_lip', lc, metallic=lm, roughness=lr),
        'lug': materials.pbr('lug', '#d8dbe0', metallic=1.0, roughness=0.2),
        'brake_disc': materials.pbr('brake_disc', '#6a6d72', metallic=0.85, roughness=0.45),
        'caliper': materials.pbr('caliper', common['caliper'], metallic=0.2, roughness=0.35),
    }


def build(spec, common, inches):
    scene.reset()
    mats = wheel_materials(spec, common)
    root = scene.empty('wheel_root', display='ARROWS', size=0.3)
    for lod in LODS:
        build_wheel(spec, common, inches, lod, root, mats)
    return root


REQUIRED = ['wheel_root', 'wheel', 'wheel_LOD1', 'wheel_LOD2', 'brake', 'brake_LOD1', 'brake_LOD2']


def tri_count(name):
    o = bpy.data.objects[name]
    if o.type != 'MESH':
        return 0
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--only')
    p.add_argument('--no-render', action='store_true')
    a = p.parse_args(argv)
    with open(os.path.join(SPECS, '_common.json'), encoding='utf-8') as f:
        common = json.load(f)
    specs = []
    for path in sorted(glob.glob(os.path.join(SPECS, 'w*.json'))):
        with open(path, encoding='utf-8') as f:
            s = json.load(f)
        if not a.only or s['id'] == a.only:
            specs.append(s)
    out_r = os.path.join(scene.ART, 'renders', 'wheels')
    os.makedirs(out_r, exist_ok=True)
    tiles = []
    failed = []
    for s in specs:
        for inch in common['rimInches']:
            wid = f'{s["id"]}_{inch}'
            root = build(s, common, inch)
            errs = checks.run(root, REQUIRED)
            budget = common['budget']['lod0']
            t0 = tri_count('wheel')
            if t0 > budget:
                errs.append(f'wheel: {t0} треугольников > {budget}')
            for e in errs:
                print(f'CHECK {wid}: {e}')
            if errs:
                failed.append(wid)
            glb = os.path.join(scene.ART, 'export', 'wheels', f'{wid}.glb')
            export.glb(root, glb, tangents=True)
            scene.save_blend(os.path.join(scene.ART, 'source', 'wheels', f'{wid}.blend'))
            print(f'WHEEL {wid}: LOD0 {t0}, LOD1 {tri_count("wheel_LOD1")}, '
                  f'LOD2 {tri_count("wheel_LOD2")}, тормоз {tri_count("brake")} треугольников')
            if not a.no_render:
                tiles.append(render.wheel_tile(root, os.path.join(out_r, f'{wid}.png'),
                                               f'{s["id"]}  {inch}"', common['tire']['outerDiameter'] / 2))
    if tiles:
        sheet = render.compose(tiles, os.path.join(out_r, 'sheet.png'), cols=4, tile=512)
        print(f'SHEET: {sheet}')
    if failed:
        raise SystemExit(f'ошибки проверок: {", ".join(failed)}')


if __name__ == '__main__':
    main()
