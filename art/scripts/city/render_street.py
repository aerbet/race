"""Рендер «улица ночью» (BLENDER_PLAN 6.5, п. 1): модули набора вдоль проспекта, фонари, снег.

Запуск: pnpm art:city moscow (после build_modules) → art/renders/city_moscow/street_night.png
"""

import math
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from city import build_modules  # noqa: E402
from lib import materials, scene  # noqa: E402

STREETS = {'moscow': [  # (модуль, сторона, позиция вдоль улицы)
    ('stalinka_c', -1, 0), ('stalinka_b', -1, 58), ('church_a', -1, 104), ('panel16_b', -1, 140),
    ('tower_b', -1, 200), ('stalinka_a', 1, 6), ('pavilion_b', 1, 34), ('stalinka_d', 1, 52),
    ('khrush_c', 1, 92), ('mall_a', 1, 150), ('panel9_b', 1, 215), ('tower_c', 1, 290),
], 'tokyo': [
    ('narrow_a', -1, 0), ('narrow_c', -1, 11), ('narrow_b', -1, 22), ('konbini_a', -1, 35), ('narrow_d', -1, 50),
    ('stair_b', -1, 72), ('mall_t', -1, 110), ('office_b', -1, 175), ('narrow_b', 1, 4), ('cafe_a', 1, 16),
    ('narrow_c', 1, 27), ('narrow_a', 1, 38), ('stair_a', 1, 60), ('narrow_d', 1, 82), ('office_a', 1, 130),
    ('office_c', 1, 200),
]}
PROPS = {
    'moscow': ((20, 1, 'prop_bus_stop'), (70, -1, 'prop_billboard'), (110, 1, 'prop_snowbank'),
               (-10, -1, 'prop_snowbank'), (45, -1, 'prop_barrier'), (140, 1, 'prop_billboard')),
    'tokyo': ((8, 1, 'prop_vending'), (30, -1, 'prop_lantern'), (36, -1, 'prop_lantern'), (66, 1, 'prop_billboard'),
              (45, 1, 'prop_vending'), (20, -1, 'prop_barrier')),
}
FAR = {'moscow': ('tv_tower', (520, 160, 0)), 'tokyo': ('lattice_tower', (480, 140, 0))}
ROAD = 15.0  # половина ширины проезжей части (Токио — 9)
WALK = 6.0


def plane(name, x0, x1, y0, y1, z, mat):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z))]
    bm.faces.new(vs)
    return scene.mesh_object(name, bm, materials=[mat])


def lamp(x, y, side):
    pole = materials.pbr('lamp_pole', '#2b2d31', metallic=0.6, roughness=0.5)
    head = materials.pbr('lamp_head', '#fff2d0', emission='#ffd9a0', strength=40.0)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.12, radius2=0.08, depth=9.0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, y, 4.5))
    scene.mesh_object('lamp_pole', bm, materials=[pole])
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.5, 1.6, 0.18), verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, y - side * 1.4, 9.0))
    scene.mesh_object('lamp_head', bm, materials=[head])
    li = bpy.data.lights.new('lamp', 'SPOT')
    li.energy, li.spot_size, li.spot_blend = 9000, math.radians(120), 0.6
    li.color = (1.0, 0.82, 0.6)
    o = bpy.data.objects.new('lamp_light', li)
    o.location = (x, y - side * 1.4, 8.8)
    bpy.context.scene.collection.objects.link(o)


def main():
    global ROAD
    kit = build_modules.kit_arg()
    if kit == 'tokyo':
        ROAD = 9.0
    STREET = STREETS[kit]
    root = build_modules.main(kit)
    mods = {o.name: o for o in root.children}
    for o in root.children:
        o.hide_render = True
    for mid, side, s in STREET:
        src = mods[mid]
        o = bpy.data.objects.new(f'{mid}_inst', src.data)
        bpy.context.scene.collection.objects.link(o)
        d = [m for m in build_modules.KITS[kit] if m[0] == mid][0]
        # фасад (−Y модуля) смотрит на улицу
        o.location = (s, side * (ROAD + WALK + d[3] / 2 + 1), 0)
        o.rotation_euler = (0, 0, 0 if side > 0 else math.pi)
    # Ориентир вдали и реквизит на тротуарах
    def inst(name, loc, rot=0.0):
        src = bpy.data.objects[name]
        o = bpy.data.objects.new(f'{name}_i', src.data)
        bpy.context.scene.collection.objects.link(o)
        o.location, o.rotation_euler = loc, (0, 0, rot)
    for o in bpy.data.objects:
        if o.parent and o.parent.name == 'landmarks_root':
            o.hide_render = True
    inst(*FAR[kit])
    for x, side, pid in PROPS[kit]:
        # −Y реквизита — к дороге
        inst(pid, (x, side * (ROAD + 1.6), 0.15), 0 if side > 0 else math.pi)
    asphalt = materials.pbr('asphalt', '#1a1b1f', roughness=0.35)
    snow = materials.pbr('snow', '#c9d0da', roughness=0.8) if kit == 'moscow' else         materials.pbr('pavement', '#4a4c52', roughness=0.7)
    plane('road', -60, 340, -ROAD, ROAD, 0, asphalt)
    for side in (-1, 1):
        plane('walk', -60, 340, side * ROAD, side * (ROAD + WALK + 40), 0.15, snow)
        for x in range(-40, 340, 32):
            lamp(x, side * (ROAD + 0.8), side)
    # Разметка
    line = materials.pbr('line', '#d8d8d0', roughness=0.6)
    for x in range(-60, 340, 12):
        plane('dash', x, x + 6, -0.12, 0.12, 0.01, line)
    w = bpy.data.worlds.new('night')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.012, 0.016, 0.03, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    bpy.context.scene.world = w
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.data.lens = 24
    eye, target = Vector((-30, -6, 3.0)), Vector((120, 3, 14))
    cam.location = eye
    cam.rotation_euler = (target - eye).to_track_quat('-Z', 'Y').to_euler()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.cycles.device = 'CPU'
    sc.view_settings.view_transform = 'AgX'
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    sc.render.image_settings.file_format = 'PNG'
    out = os.path.join(scene.ART, 'renders', f'city_{kit}')
    os.makedirs(out, exist_ok=True)
    sc.render.filepath = os.path.join(out, 'street_night.png')
    bpy.ops.render.render(write_still=True)
    print('STREET:', sc.render.filepath)


if __name__ == '__main__':
    main()
