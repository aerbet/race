"""Тестовая модель B0: «кубик» с 4 колёсами и всеми узлами из ART_BRIEF.

Не игровая машина — только проверка конвейера Блендер → glb → валидатор → игра.
Оси Блендера: нос по +Y, верх +Z, начало координат — на земле между осями.
"""

import math

import bmesh
import bpy
from mathutils import Matrix

from lib import materials, scene


def _box(x0, x1, y0, y1, z0, z1, bevel=0.0, cuts=0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, verts=bm.verts, matrix=Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))
    bmesh.ops.translate(bm, verts=bm.verts, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    if bevel:
        # Фаска только по рёбрам силуэта (внутренние рёбра сетки — плоские)
        sharp = [e for e in bm.edges if e.calc_face_angle(0) > 0.5]
        bmesh.ops.bevel(bm, geom=sharp, offset=bevel, segments=3,
                        affect='EDGES', profile=0.5)
    bm.normal_update()
    return bm


def _cyl(r, depth, seg=32, axis='X', bm=None, offset=0.0):
    bm = bm or bmesh.new()
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                                radius1=r, radius2=r, depth=depth)
    verts = res['verts']
    if axis == 'X':
        bmesh.ops.rotate(bm, verts=verts, matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
        bmesh.ops.translate(bm, verts=verts, vec=(offset, 0, 0))
    elif axis == 'Y':
        bmesh.ops.rotate(bm, verts=verts, matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
        bmesh.ops.translate(bm, verts=verts, vec=(0, offset, 0))
    return bm, verts


def _merge(*bms):
    out = bmesh.new()
    for b in bms:
        me = bpy.data.meshes.new('_tmp')
        b.to_mesh(me)
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
        b.free()
    return out


def build(spec):
    d = spec['dimensions']
    L, W, H = d['length'], d['width'], d['height']
    wb, tr, R = d['wheelbase'], d['trackFront'], d['wheelDiameter'] / 2
    gc = d['groundClearance']
    tw = d.get('tireWidth', 0.22)
    mats = materials.car_set(spec['paint']['default'])
    root = scene.empty('car_root', display='ARROWS', size=0.5)
    half, bw = L / 2, W * 0.82 / 2
    belt = gc + (H - gc) * 0.55

    def part(name, bm, mat_keys):
        return scene.mesh_object(name, bm, root, [mats[k] for k in mat_keys])

    part('body', _box(-bw, bw, -half + 0.16, half - 0.16, gc + 0.12, belt, bevel=0.05, cuts=6), ['paint'])
    part('hood', _box(-bw * 0.9, bw * 0.9, 0.55, half - 0.3, belt, belt + 0.03, bevel=0.01), ['paint'])
    part('bumper_front', _box(-W / 2 * 0.86, W / 2 * 0.86, half - 0.2, half, gc, gc + 0.32, bevel=0.04), ['paint'])
    part('bumper_rear', _box(-W / 2 * 0.86, W / 2 * 0.86, -half, -half + 0.2, gc, gc + 0.32, bevel=0.04), ['paint'])
    sk = _merge(*(_box(s * bw - 0.03, s * bw + 0.03, -wb / 2 + R + 0.05, wb / 2 - R - 0.05, gc, gc + 0.1)
                  for s in (-1, 1)))
    part('skirts', sk, ['trim'])
    sp = _merge(_box(-bw * 0.95, bw * 0.95, -half + 0.12, -half + 0.42, H - 0.05, H - 0.01, bevel=0.01),
                *(_box(s * bw * 0.6 - 0.02, s * bw * 0.6 + 0.02, -half + 0.22, -half + 0.32, belt, H - 0.05)
                  for s in (-1, 1)))
    part('spoiler', sp, ['dark'])
    part('glass', _box(-bw * 0.85, bw * 0.85, -0.95, 0.5, belt, H - 0.15, bevel=0.06), ['glass'])
    part('interior_low', _box(-bw * 0.7, bw * 0.7, -0.7, 0.3, belt - 0.1, belt + 0.35), ['interior'])
    hl = _merge(*(_box(s * bw * 0.62 - 0.2, s * bw * 0.62 + 0.2, half - 0.18, half - 0.12, belt - 0.12, belt - 0.04)
                  for s in (-1, 1)))
    part('lights_front', hl, ['headlight'])
    tl = _merge(*(_box(s * bw * 0.62 - 0.22, s * bw * 0.62 + 0.22, -half + 0.12, -half + 0.18, belt - 0.12, belt - 0.04)
                  for s in (-1, 1)))
    part('lights_rear', tl, ['taillight'])
    ex, _ = _cyl(0.045, 0.2, seg=16, axis='Y', offset=-half + 0.05)
    bmesh.ops.translate(ex, verts=ex.verts, vec=(bw * 0.5, 0, gc + 0.08))
    part('exhaust', ex, ['chrome'])

    # Колёса: центр объекта — в оси вращения. Шина (32 сегмента) + диск-заглушка
    for tag, y, x in (('FL', wb / 2, -tr / 2), ('FR', wb / 2, tr / 2),
                      ('RL', -wb / 2, -tr / 2), ('RR', -wb / 2, tr / 2)):
        out = 1 if x > 0 else -1
        tire, _ = _cyl(R, tw, seg=32)
        rim, _ = _cyl(R * 0.62, 0.02, seg=24, offset=out * (tw / 2 + 0.005))
        wbm = _merge(tire, rim)
        # Второй материал (диск) — грани диска идут после граней шины
        nf_tire = 32 + 2
        for i, f in enumerate(wbm.faces):
            f.material_index = 0 if i < nf_tire else 1
        w = part(f'wheel_{tag}', wbm, ['tire', 'rim'])
        w.location = (x, y, R)
        br, _ = _cyl(R * 0.55, 0.03, seg=24, offset=-out * 0.04)
        b = part(f'brake_{tag}', br, ['brake'])
        b.location = (x, y, R)

    scene.empty('socket_spoiler', root, (0, -half + 0.27, H - 0.03))
    scene.empty('socket_exhaust', root, (bw * 0.5, -half, gc + 0.08))
    scene.empty('socket_plate_front', root, (0, half, gc + 0.18))
    scene.empty('socket_plate_rear', root, (0, -half, gc + 0.22))
    return root
