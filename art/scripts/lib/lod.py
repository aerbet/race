"""LOD: копии мешей с суффиксами _LOD1 / _LOD2 через Decimate (ART_BRIEF: ~40% / ~10%)."""

import bpy

from . import scene

RATIOS = {'_LOD1': 0.4, '_LOD2': 0.1}


def tri_count(o):
    me = o.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def make_lods(root, skip=('glass',), drop_lod2=('interior_low',)):
    """Для каждого меша под root создать _LOD1/_LOD2 рядом (тот же родитель).

    Колёса и тормоза — тоже: у них центр в оси вращения, копия наследует его.
    drop_lod2: меши, которых на LOD2 нет (салон издалека не виден) — создаётся
    пустой объект-заглушка, чтобы клиент не искал узел.
    """
    src = [o for o in root.children_recursive
           if o.type == 'MESH' and '_LOD' not in o.name and not o.name.endswith('_collision')
           and not bpy.data.objects.get(o.name + '_LOD1')]  # уже есть свои LOD (колёса из генератора дисков)
    made = []
    for o in src:
        for suffix, ratio in RATIOS.items():
            name = o.name + suffix
            if suffix == '_LOD2' and o.name in drop_lod2:
                scene.empty(name, o.parent, o.location)
                continue
            c = o.copy()
            c.data = o.data.copy()
            c.name = name
            c.data.name = name
            scene.link(c, o.parent)
            c.matrix_parent_inverse = o.matrix_parent_inverse
            if o.name not in skip:
                d = c.modifiers.new('decimate', 'DECIMATE')
                d.ratio = ratio
                d.use_collapse_triangulate = True
                scene.select_only([c])
                bpy.ops.object.modifier_apply(modifier=d.name)
            made.append(c)
    return made
