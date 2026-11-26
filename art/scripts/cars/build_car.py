"""Сборка машины по спецификации: модель → проверки → LOD → UV → экспорт → рендеры.

Запуск (через `pnpm art:car <id>`):
  blender -b --factory-startup -P art/scripts/cars/build_car.py -- --spec art/specs/cars/<id>.json
"""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import bpy  # noqa: E402

from lib import bake, checks, export, lod, render, scene, uv  # noqa: E402

REQUIRED = [
    'car_root', 'body', 'hood', 'bumper_front', 'bumper_rear', 'skirts', 'spoiler', 'glass',
    'lights_front', 'lights_rear', 'interior_low', 'exhaust',
    *(f'wheel_{t}' for t in ('FL', 'FR', 'RL', 'RR')),
    *(f'brake_{t}' for t in ('FL', 'FR', 'RL', 'RR')),
    'socket_spoiler', 'socket_exhaust', 'socket_plate_front', 'socket_plate_rear',
]

# Окрашенные части: общий атлас uv0 и запечённый AO
PAINTED = ('body', 'hood', 'bumper_front', 'bumper_rear', 'skirts', 'spoiler')


def generator(spec):
    g = spec.get('generator', 'car')
    if g == 'test_rig':
        from cars import test_rig
        return test_rig.build
    from cars import car
    return car.build


def smooth_shading(root):
    """Кузовные панели — гладкие с острыми гранями по углу 32°; колёса сглажены в генераторе."""
    import math
    objs = [o for o in root.children_recursive if o.type == 'MESH'
            and not o.name.startswith(('wheel_', 'brake_', 'interior', 'lights_'))]
    scene.select_only(objs)
    if objs:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32))


def main():
    a = scene.args()
    spec = scene.load_spec(a.spec)
    p = scene.paths('cars', spec['id'])
    if a.render_only:
        bpy.ops.wm.open_mainfile(filepath=p['blend'])
        root = bpy.data.objects['car_root']
    else:
        scene.reset()
        root = generator(spec)(spec)
        scene.apply_all(root)
        smooth_shading(root)
        meshes = [o for o in root.children_recursive if o.type == 'MESH']
        # uv0: окрашенные части — общий атлас (под AO), остальное — отдельно;
        # у колёс своя развёртка шины под карту протектора — не трогаем
        painted = [o for o in meshes if o.name in PAINTED]
        other = [o for o in meshes if o not in painted and not o.name.startswith(('wheel_', 'brake_'))]
        uv.smart_uv0(painted)
        uv.smart_uv0(other)
        uv.livery_uv1(bpy.data.objects['body'])
        errs = checks.run(root, REQUIRED)
        if errs:
            print('\n'.join(f'CHECK: {e}' for e in errs))
            raise SystemExit(f'checks.py: {len(errs)} ошибок')
        if spec.get('generator', 'car') == 'car':
            mats = {m for o in painted for m in o.data.materials}
            bake.bake_ao(painted, mats, size=1024, samples=64,
                         path=os.path.join(scene.ART, 'export', 'cars', spec['id'], 'ao_body.png'))
            print('AO: запечено')
        lod.make_lods(root)
        export.glb(root, p['glb'])
        print(f'GLB: {p["glb"]}')
        if spec.get('kits'):
            # Кузовные киты (BLENDER_PLAN 5.4): строятся от того же кузова, после экспорта базы
            from cars import kits
            kit_roots = kits.build_kits(spec, root)
            errs = [e for r in kit_roots.values() for e in checks.run(r)]
            if errs:
                print('\n'.join(f'CHECK: {e}' for e in errs))
                raise SystemExit(f'checks.py (киты): {len(errs)} ошибок')
            for kid, path in kits.finish_kits(kit_roots, spec, os.path.dirname(p['glb'])).items():
                print(f'KIT: {path}')
        scene.save_blend(p['blend'])
    if not a.no_render:
        if spec.get('kits'):
            from cars import kits
            kit_roots = {k: bpy.data.objects[f'kit_{k}'] for k in spec['kits']}
            for f in kits.render_kits(root, kit_roots, p['renders']):
                print(f'KITS: {f}')
        sheet = render.all_car(root, p['renders'])
        print(f'SHEET: {sheet}')


main()
