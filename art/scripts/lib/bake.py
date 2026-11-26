"""Запекание ambient occlusion (BLENDER_PLAN 5.2, шаг 7) и подключение к glTF как occlusionTexture.

Все окрашенные части кузова развёрнуты в один атлас uv0, AO запекается Cycles в одну
картинку. Экспортёр glTF берёт occlusion из группы нод «glTF Material Output» (вход Occlusion).
"""

import os

import bpy

from . import scene


def _gltf_output_group():
    name = 'glTF Material Output'
    g = bpy.data.node_groups.get(name)
    if g:
        return g
    g = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    g.nodes.new('NodeGroupInput')
    return g


def _reload(old, path, name):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    bpy.data.images.remove(old)
    img.name = name
    return img


def bake_ao(objs, mats, size=2048, samples=32, distance=0.6, path=None, name='ao_body'):
    """Запечь AO выбранных объектов в одну картинку и подключить её ко всем материалам mats."""
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    if not sc.world:
        sc.world = bpy.data.worlds.new('bake_world')
    sc.world.light_settings.distance = distance
    nodes = {}
    for m in mats:
        nt = m.node_tree
        uvn = nt.nodes.new('ShaderNodeUVMap')
        uvn.uv_map = 'uv0'
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        tex.name = 'ao_tex'
        nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
        nt.nodes.active = tex
        nodes[m] = tex
    scene.select_only(objs)
    sc.render.bake.margin = 8
    sc.render.bake.use_clear = True
    bpy.ops.object.bake(type='AO', margin=8, use_clear=True)
    if path:
        # JPEG: AO — плавные градации серого, в PNG 2048 весит ~1,6 МБ, в JPEG ~0,3 МБ
        # (пока нет toktx для KTX2); экспортёр glTF сохраняет формат картинки
        os.makedirs(os.path.dirname(path), exist_ok=True)
        path = os.path.splitext(path)[0] + '.jpg'
        st = sc.render.image_settings
        st.file_format = 'JPEG'
        st.color_mode = 'BW'
        st.quality = 88
        img.save_render(path, scene=sc)
        st.file_format, st.color_mode = 'PNG', 'RGBA'
        img = _reload(img, path, name)
        for tex in nodes.values():
            tex.image = img
    img.pack()
    # Подключение: картинка → группа «glTF Material Output».Occlusion
    grp = _gltf_output_group()
    for m, tex in nodes.items():
        nt = m.node_tree
        gn = nt.nodes.new('ShaderNodeGroup')
        gn.node_tree = grp
        nt.links.new(tex.outputs['Color'], gn.inputs['Occlusion'])
    return img
