"""Развёртки: uv0 — текстуры без перекрытий, uv1 — под ливреи (ART_BRIEF)."""

import math

import bpy

from . import scene


def ensure_layers(o):
    """У каждого меша ровно два слоя UV с именами uv0 и uv1 (glTF: TEXCOORD_0/1)."""
    uvs = o.data.uv_layers
    while len(uvs) < 2:
        uvs.new()
    uvs[0].name = 'uv0'
    uvs[1].name = 'uv1'


def smart_uv0(objs, margin_px=4, size=2048):
    """Smart UV Project для uv0 с отступом margin_px при атласе size."""
    for o in objs:
        ensure_layers(o)
        o.data.uv_layers.active = o.data.uv_layers['uv0']
    scene.select_only(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin_px / size)
    bpy.ops.object.mode_set(mode='OBJECT')


def livery_uv1(o):
    """Развёртка под ливреи по зонам атласа: бока, верх (капот+крыша), перёд, зад.

    Каждая грань проецируется по своей доминирующей оси в свою зону; масштаб
    одинаковый для всех зон, поэтому шахматка не растягивается.
    Зоны (u0, v0, u1, v1): левый бок, правый бок — снизу, верх — по центру,
    перёд и зад — сверху.
    """
    ensure_layers(o)
    me = o.data
    uv = me.uv_layers['uv1'].data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    sx, sy, sz = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
    x0, y0, z0 = min(xs), min(ys), min(zs)
    # Общий масштаб: длина по U, по V — бок + бок + верх + ряд «перёд | зад»
    gap = 0.02
    k = min((1 - 2 * gap) / max(sy, 1e-6), (1 - 5 * gap) / max(3 * sz + sx, 1e-6),
            (1 - 3 * gap) / 2 / max(sx, 1e-6))
    v1 = gap + sz * k + gap
    v2 = v1 + sz * k + gap
    v3 = v2 + sx * k + gap
    zones = {
        'left': (gap, gap), 'right': (gap, v1), 'top': (gap, v2),
        'front': (gap, v3), 'rear': (gap * 2 + sx * k, v3),
    }
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        if ax == 0:
            zone = 'left' if n.x < 0 else 'right'
        elif ax == 2:
            zone = 'top'
        else:
            zone = 'front' if n.y > 0 else 'rear'
        u0, v0 = zones[zone]
        for li in poly.loop_indices:
            c = me.vertices[me.loops[li].vertex_index].co
            if zone in ('left', 'right'):
                u, v = (c.y - y0) * k, (c.z - z0) * k
            elif zone == 'top':
                u, v = (c.y - y0) * k, (c.x - x0) * k
            else:
                u, v = (c.x - x0) * k, (c.z - z0) * k
            uv[li].uv = (u0 + u, v0 + v)
