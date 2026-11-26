"""Экспорт в glTF Binary: Y-up, модификаторы применены, без камер и света."""

import os

import bpy

from . import scene


def glb(root, path, tangents=False):
    objs = [root, *root.children_recursive]
    scene.select_only(objs)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=tangents,  # нужны для карт нормалей
        export_materials='EXPORT',
        export_animations=False,
    )
    return path
