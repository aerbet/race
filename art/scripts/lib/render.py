"""Рендеры для проверки (BLENDER_PLAN 5.5) и лист sheet.png.

Орто-виды — Workbench (силуэт и контур), 3/4 и ночь — Cycles 64 сэмпла + шумодав.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Vector

from . import materials, scene

RES = 1024


def _lod_objs(root, level):
    """Объекты нужного LOD: level 0 — без суффикса."""
    out = []
    for o in root.children_recursive:
        if o.type != 'MESH':
            continue
        suf = next((s for s in ('_LOD1', '_LOD2') if o.name.endswith(s)), '')
        if (level == 0 and not suf) or (level and suf == f'_LOD{level}'):
            out.append(o)
    return out


def show_lod(root, level):
    vis = set(_lod_objs(root, level))
    for o in root.children_recursive:
        if o.type == 'MESH':
            o.hide_render = o not in vis


def bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def _camera(name='render_cam'):
    cam = bpy.data.objects.get(name)
    if cam:
        return cam
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def _aim(cam, eye, target):
    cam.location = eye
    cam.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()


def _setup(engine, samples=64):
    s = bpy.context.scene
    s.render.resolution_x = s.render.resolution_y = RES
    s.render.resolution_percentage = 100
    s.render.image_settings.file_format = 'PNG'
    s.render.film_transparent = False
    if engine == 'WORKBENCH':
        s.render.engine = 'BLENDER_WORKBENCH'
        sh = s.display.shading
        sh.light = 'STUDIO'
        sh.color_type = 'MATERIAL'
        sh.show_object_outline = True
        sh.object_outline_color = (0, 0, 0)
        sh.show_cavity = True
        sh.background_type = 'VIEWPORT'
        sh.background_color = (0.85, 0.86, 0.88)
        s.view_settings.view_transform = 'Standard'
    else:
        s.render.engine = 'CYCLES'
        s.cycles.samples = samples
        s.cycles.use_denoising = True
        s.cycles.device = 'CPU'
        s.view_settings.view_transform = 'AgX'


def _render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def _temp(objs):
    """Удалить временные объекты рендера."""
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)


def ortho(root, out, level=0, views=('side', 'front', 'rear', 'top'), suffix=''):
    show_lod(root, level)
    lo, hi = bbox(_lod_objs(root, level))
    c = (lo + hi) / 2
    size = hi - lo
    cam = _camera()
    cam.data.type = 'ORTHO'
    _setup('WORKBENCH')
    d = 20
    files = []
    for v in views:
        if v == 'side':
            eye, span = c + Vector((d, 0, 0)), max(size.y, size.z)
        elif v == 'front':
            eye, span = c + Vector((0, d, 0)), max(size.x, size.z)
        elif v == 'rear':
            eye, span = c + Vector((0, -d, 0)), max(size.x, size.z)
        else:
            eye, span = c + Vector((0, 0, d)), max(size.x, size.y)
        _aim(cam, eye, c)
        if v == 'top':
            cam.rotation_euler = (0, 0, math.pi / 2)  # нос вправо, как на виде сбоку
        cam.data.ortho_scale = span * 1.15
        files.append(_render(os.path.join(out, f'{v}{suffix}.png')))
    return files


def _studio():
    w = bpy.data.worlds.new('studio')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.18, 0.19, 0.21, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    bpy.context.scene.world = w
    made = []
    for name, loc, e, size in (('key', (4, 3, 5), 900, 4), ('fill', (-5, 1, 3), 300, 5),
                               ('rim', (0, -6, 4), 500, 4)):
        lt = bpy.data.lights.new(name, 'AREA')
        lt.energy, lt.size = e, size
        o = bpy.data.objects.new(name, lt)
        bpy.context.scene.collection.objects.link(o)
        _aim(o, loc, (0, 0, 0.5))
        made.append(o)
    floor = _floor('#2a2c30', 0.6)
    return made + [floor]


def _floor(color, rough):
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40)
    o = scene.mesh_object('render_floor', bm,
                          materials=[materials.pbr(f'render_floor_{color}', color, roughness=rough)])
    return o


def perspective(root, out):
    show_lod(root, 0)
    lo, hi = bbox(_lod_objs(root, 0))
    c = (lo + hi) / 2
    r = (hi - lo).length
    temp = _studio()
    cam = _camera()
    cam.data.type = 'PERSP'
    cam.data.lens = 50
    _setup('CYCLES', 64)
    files = []
    for name, dirv in (('three_quarter_front', (0.75, 0.85, 0.32)),
                       ('three_quarter_rear', (-0.75, -0.85, 0.32))):
        _aim(cam, c + Vector(dirv).normalized() * r * 1.55, c)
        files.append(_render(os.path.join(out, f'{name}.png')))
    _temp(temp)
    return files


def night(root, out):
    show_lod(root, 0)
    lo, hi = bbox(_lod_objs(root, 0))
    c = (lo + hi) / 2
    r = (hi - lo).length
    w = bpy.data.worlds.new('night')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.01, 0.012, 0.03, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.4
    bpy.context.scene.world = w
    temp = [_floor('#08090c', 0.12)]  # мокрый асфальт — почти зеркало
    for name, loc, col, e in (('neon_a', (-4, 2, 3), (1, 0.2, 0.85), 600),
                              ('neon_b', (4, -3, 3.5), (0.2, 0.6, 1), 700),
                              ('street', (1, 2, 7), (1, 0.75, 0.45), 1600)):
        lt = bpy.data.lights.new(name, 'POINT')
        lt.energy, lt.color, lt.shadow_soft_size = e, col, 0.5
        o = bpy.data.objects.new(name, lt)
        o.location = loc
        o.visible_camera = False  # сама лампа в кадре не видна, только её свет
        bpy.context.scene.collection.objects.link(o)
        temp.append(o)
    # Пятна фар на асфальте
    for s in (-1, 1):
        lt = bpy.data.lights.new(f'head_{s}', 'SPOT')
        lt.energy, lt.spot_size, lt.color = 300, math.radians(40), (0.95, 0.97, 1)
        o = bpy.data.objects.new(f'head_{s}', lt)
        bpy.context.scene.collection.objects.link(o)
        _aim(o, (s * 0.6, hi.y + 0.05, lo.z + 0.6), (s * 0.8, hi.y + 8, 0))
        temp.append(o)
    cam = _camera()
    cam.data.type = 'PERSP'
    cam.data.lens = 40
    _setup('CYCLES', 64)
    _aim(cam, c + Vector((0.9, 1.4, 0.25)).normalized() * r * 1.5, c + Vector((0, 0.6, -0.2)))
    f = _render(os.path.join(out, 'night.png'))
    _temp(temp)
    return [f]


def uv_check(root, out, body='body'):
    """Шахматка на uv1 кузова: проверка, что ливреи не растянуты."""
    show_lod(root, 0)
    o = bpy.data.objects.get(body)
    img = bpy.data.images.new('uv_checker', 1024, 1024)
    img.generated_type = 'COLOR_GRID'
    m = bpy.data.materials.new('uv_check')
    m.use_nodes = True
    nt = m.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Closest'
    uvn = nt.nodes.new('ShaderNodeUVMap')
    uvn.uv_map = 'uv1'
    nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    saved = list(o.data.materials)
    for i in range(len(o.data.materials)):
        o.data.materials[i] = m
    temp = _studio()
    lo, hi = bbox([o])
    c = (lo + hi) / 2
    cam = _camera()
    cam.data.type = 'PERSP'
    cam.data.lens = 50
    _setup('CYCLES', 16)
    _aim(cam, c + Vector((0.8, 0.6, 0.45)).normalized() * (hi - lo).length * 1.55, c)
    f = _render(os.path.join(out, 'uv_check.png'))
    for i, sm in enumerate(saved):
        o.data.materials[i] = sm
    _temp(temp)
    return [f]


def lod_strip(root, out):
    """LOD0 / LOD1 / LOD2 рядом (вид сбоку)."""
    files = []
    for lv in (0, 1, 2):
        files += ortho(root, out, lv, views=('side',), suffix=f'_lod{lv}')
    path = os.path.join(out, 'lod.png')
    compose(files, path, cols=3, tile=512)
    for f in files:
        os.remove(f)  # временные кадры, итог — lod.png
    show_lod(root, 0)
    return [path]


def _load(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


def _resize(a, size):
    h, w, _ = a.shape
    ys = (np.arange(size) * h / size).astype(int)
    xs = (np.arange(size) * w / size).astype(int)
    return a[ys][:, xs]


def compose(files, path, cols=3, tile=512, bg=(0.08, 0.08, 0.1, 1)):
    """Собрать картинки в сетку (пиксели Блендера идут снизу вверх)."""
    files = [f for f in files if f and os.path.exists(f)]
    rows = math.ceil(len(files) / cols)
    sheet = np.empty((rows * tile, cols * tile, 4), dtype=np.float32)
    sheet[:] = bg
    for i, f in enumerate(files):
        r, c = divmod(i, cols)
        y0 = (rows - 1 - r) * tile
        sheet[y0:y0 + tile, c * tile:(c + 1) * tile] = _resize(_load(f), tile)
    img = bpy.data.images.new('sheet', cols * tile, rows * tile, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    return path


SHEET_ORDER = ['three_quarter_front', 'three_quarter_rear', 'night', 'side', 'front', 'rear',
               'top', 'uv_check', 'lod', 'kits']


def all_car(root, out):
    """Полный набор рендеров машины + sheet.png."""
    ortho(root, out)
    perspective(root, out)
    night(root, out)
    uv_check(root, out)
    lod_strip(root, out)
    files = [os.path.join(out, f'{n}.png') for n in SHEET_ORDER]
    return compose(files, os.path.join(out, 'sheet.png'), cols=3, tile=512)
