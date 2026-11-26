"""Проверки геометрии перед экспортом: имена, нормали, дубли вершин, вырожденные грани."""

import re

import bmesh
from mathutils import Vector

DEFAULT_NAME = re.compile(r'^(Cube|Sphere|Cylinder|Plane|Circle|Empty|Mesh|Object)(\.\d+)?$|\.\d{3}$')


def mesh_errors(o, merge_dist=1e-5, min_area=1e-9, outer=None):
    errs = []
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.normal_update()
    # Дубли вершин
    dup = bmesh.ops.find_doubles(bm, verts=bm.verts, dist=merge_dist)['targetmap']
    if dup:
        v = next(iter(dup))
        errs.append(f'{o.name}: {len(dup)} дублирующихся вершин (например, у {v.co.x:.3f}, {v.co.y:.3f}, {v.co.z:.3f})')
    # Вырожденные грани
    degen = [f for f in bm.faces if f.calc_area() < min_area]
    if degen:
        c = degen[0].calc_center_median()
        errs.append(f'{o.name}: {len(degen)} вырожденных граней (например, у {c.x:.3f}, {c.y:.3f}, {c.z:.3f})')
    # Нормали наружу: для замкнутых частей объём через знаковую сумму > 0
    closed = all(e.is_manifold for e in bm.edges) and len(bm.faces) > 0
    if closed:
        vol = bm.calc_volume(signed=True)
        if vol < 0:
            errs.append(f'{o.name}: нормали внутрь (объём {vol:.4f})')
    else:
        # Открытые меши: средняя нормаль должна смотреть от центра объекта или от центра машины
        # (почти плоская крышка капота «от своего центра» неразличима)
        def score(c):
            return sum((f.calc_center_median() - c).dot(f.normal) * f.calc_area() for f in bm.faces)
        c = sum((v.co for v in bm.verts), Vector()) / max(len(bm.verts), 1)
        if bm.faces and score(c) < 0 and (outer is None or score(outer) < 0):
            errs.append(f'{o.name}: нормали, похоже, внутрь')
    bm.free()
    return errs


def run(root, required=()):
    """Список ошибок; пустой — модель чистая."""
    errs = []
    objs = [root, *root.children_recursive]
    names = {o.name for o in objs}
    meshes = [o for o in objs if o.type == 'MESH' and len(o.data.vertices)]
    pts = [Vector(c) for o in meshes for c in o.bound_box]
    outer = (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))) +
             Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))) / 2 if pts else None
    for o in objs:
        if DEFAULT_NAME.search(o.name):
            errs.append(f'имя по умолчанию: {o.name}')
        if o.type == 'MESH':
            errs += mesh_errors(o, outer=outer)
            for m in o.data.materials:
                if m is None or DEFAULT_NAME.search(m.name) or m.name == 'Material':
                    errs.append(f'{o.name}: материал без имени')
    for n in required:
        if n not in names:
            errs.append(f'нет узла {n}')
    return errs
