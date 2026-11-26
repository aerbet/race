"""Сцена: сброс, аргументы командной строки, пути, создание объектов."""

import argparse
import json
import os
import sys

import bpy

# art/scripts/lib/scene.py -> корень репозитория
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
ART = os.path.join(REPO, 'art')


def args(extra=None):
    """Аргументы после `--` в командной строке Блендера."""
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--spec', required=True, help='JSON-спецификация модели')
    p.add_argument('--render-only', action='store_true')
    p.add_argument('--no-render', action='store_true')
    if extra:
        extra(p)
    return p.parse_args(argv)


def load_spec(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def paths(kind, model_id):
    """Куда класть .blend, .glb и рендеры модели."""
    d = {
        'blend': os.path.join(ART, 'source', kind, f'{model_id}.blend'),
        'glb': os.path.join(ART, 'export', kind, model_id, 'base.glb'),
        'renders': os.path.join(ART, 'renders', model_id),
    }
    for k in ('blend', 'glb'):
        os.makedirs(os.path.dirname(d[k]), exist_ok=True)
    os.makedirs(d['renders'], exist_ok=True)
    return d


def reset():
    """Пустая сцена: без кубов, камер и света по умолчанию, метрические единицы."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = 'METRIC'
    s.unit_settings.scale_length = 1.0
    return s


def empty(name, parent=None, location=(0, 0, 0), display='PLAIN_AXES', size=0.1):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = display
    o.empty_display_size = size
    o.location = location
    bpy.context.scene.collection.objects.link(o)
    if parent:
        o.parent = parent
    return o


def link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def mesh_object(name, bm, parent=None, materials=()):
    """Объект из bmesh; имя меша совпадает с именем объекта."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in materials:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    return link(o, parent)


def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def apply_all(root):
    """Применить модификаторы и трансформы у всех мешей под root (родитель сохраняется)."""
    meshes = [o for o in root.children_recursive if o.type == 'MESH']
    for o in meshes:
        select_only([o])
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
    select_only(meshes)
    if meshes:
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def save_blend(path):
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
