"""Рельеф горного перевала (BLENDER_PLAN 7.2).

Запуск: pnpm art:track terrain <id>  (сплайн — pnpm track:export <id>)
Вход: art/specs/track/<id>.json. Выход: art/export/tracks/terrain_<id>.glb (блоки 256 м,
узлы terrain_<i>_<j> и упрощённая коллизия terrain_<i>_<j>_collision) + terrain_<id>.json
(сосны и скалы — экземплярами элементов dressing.glb).

Высота: «тренд» — средняя высота дороги поблизости (склон горы), сверху шум fBm; у дороги
рельеф врезается: полка на 0,35 м ниже полотна, дальше откос. «Эрозия» — несколько шагов
термического сглаживания (осыпание слишком крутых склонов). Материал — атлас оформления
(ячейки хвоя / скала по крутизне), в glb без текстуры: клиент берёт её из dressing.glb.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import export, scene  # noqa: E402
from track.dressing import cell_uv  # noqa: E402

TILE = 256.0
STEP = 256.0 / 48  # ~5,3 м
COL_STEP = 256.0 / 16  # коллизия ~16 м


def fbm(x, z, seed=3, octaves=5):
    """Шум из суммы синусов с поворотами (детерминированный, без зависимостей)."""
    rng = np.random.default_rng(seed)
    out = np.zeros_like(x)
    amp, freq = 1.0, 1 / 260
    for _ in range(octaves):
        a = rng.random() * math.pi
        ph = rng.random(2) * 100
        u = x * math.cos(a) - z * math.sin(a)
        v = x * math.sin(a) + z * math.cos(a)
        out += amp * np.sin(u * freq * 2 * math.pi + ph[0]) * np.cos(v * freq * 2 * math.pi * 1.3 + ph[1])
        amp *= 0.5
        freq *= 2.03
    return out


def road_fields(xs, zs, samples):
    """Расстояние до оси дороги, высота и ширина ближайшего участка, тренд высот (ОВР)."""
    S = np.array(samples, dtype=np.float64)
    px, py, pz, pw = S[:, 0], S[:, 1], S[:, 2], S[:, 3]
    best = np.full(xs.shape, np.inf)
    by = np.zeros(xs.shape)
    bw = np.zeros(xs.shape)
    num = np.zeros(xs.shape)
    den = np.zeros(xs.shape)
    for k in range(0, len(S), 1):
        d2 = (xs - px[k]) ** 2 + (zs - pz[k]) ** 2
        m = d2 < best
        best = np.where(m, d2, best)
        by = np.where(m, py[k], by)
        bw = np.where(m, pw[k], bw)
        w = 1.0 / (d2 + 60.0 ** 2)
        num += w * py[k]
        den += w
    return np.sqrt(best), by, bw, num / den


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def heights(xs, zs, samples):
    d, by, bw, trend = road_fields(xs, zs, samples)
    edge = np.maximum(0.0, d - bw / 2 - 3.0)
    s = smoothstep(2.0, 70.0, edge)
    natural = trend + fbm(xs, zs) * 26.0 + 6.0
    h = (by - 0.35) * (1 - s) + natural * s - edge * 0.05 * (1 - s)
    return h, edge


def erode(h, step, talus=0.9, iters=12):
    """Термическая эрозия: склон круче talus (м на м) осыпается к соседям."""
    for _ in range(iters):
        for axis in (0, 1):
            dh = np.diff(h, axis=axis)
            excess = np.clip(np.abs(dh) - talus * step, 0, None) * np.sign(dh) * 0.25
            if axis == 0:
                h[:-1] += excess
                h[1:] -= excess
            else:
                h[:, :-1] += excess
                h[:, 1:] -= excess
    return h


def grid(spec, half):
    n = int(round(2 * half / STEP))
    lin = np.linspace(-half, half, n + 1)
    zs, xs = np.meshgrid(lin, lin, indexing='ij')  # [z, x]
    h, edge = heights(xs, zs, spec['samples'])
    h = erode(h, STEP)
    # у самой дороги — снова полка (эрозия не должна поднимать грунт на полотно)
    d, by, bw, _ = road_fields(xs, zs, spec['samples'])
    near = d < bw / 2 + 2.0
    h = np.where(near, np.minimum(h, by - 0.35), h)
    return lin, h, edge


def tile_mesh(lin, h, edge, i0, i1, j0, j1, step_idx=1):
    """Блок сетки [i0:i1] × [j0:j1] (индексы z, x) в bmesh с UV ячеек атласа."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('uv0')
    vs = {}
    rows = range(i0, i1 + 1, step_idx)
    cols = range(j0, j1 + 1, step_idx)
    for i in rows:
        for j in cols:
            # Блендер: X — восток, Y = −Z сцены, Z — вверх
            vs[i, j] = bm.verts.new((lin[j], -lin[i], h[i, j]))
    pine = cell_uv('pine')
    rock = cell_uv('rock')
    ri, rj = list(rows), list(cols)
    for a in range(len(ri) - 1):
        for b in range(len(rj) - 1):
            i, i2, j, j2 = ri[a], ri[a + 1], rj[b], rj[b + 1]
            f = bm.faces.new((vs[i, j], vs[i, j2], vs[i2, j2], vs[i2, j]))
            dzx = abs(h[i, j2] - h[i, j]) / (lin[j2] - lin[j])
            dzz = abs(h[i2, j] - h[i, j]) / (lin[i2] - lin[i])
            u0, v0, u1, v1 = rock if max(dzx, dzz) > 1.1 or edge[i, j] < 2 else pine
            for loop in f.loops:
                c = loop.vert.co
                # координаты внутри ячейки: мелкая вариация, без шва (повтор не нужен)
                fu = 0.5 + 0.45 * math.sin(c.x * 0.37 + c.y * 0.11)
                fv = 0.5 + 0.45 * math.sin(c.y * 0.29 - c.x * 0.07)
                loop[uv].uv = (u0 + (u1 - u0) * fu, v0 + (v1 - v0) * fv)
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])  # нормали вверх (Y = −Z сцены меняет обход)
    bm.normal_update()
    if bm.faces and sum(f.normal.z for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    return bm


def scatter(spec, lin, h, edge, seed=9):
    """Сосны на пологих склонах вдали от дороги, скалы — на крутых."""
    rng = np.random.default_rng(seed)
    half = lin[-1]
    out = []
    n = len(lin) - 1
    for _ in range(9000):
        x, z = rng.uniform(-half * 0.97, half * 0.97, 2)
        j = int((x + half) / (2 * half) * n)
        i = int((z + half) / (2 * half) * n)
        if edge[i, j] < 9:
            continue
        slope = max(abs(h[i, min(j + 1, n)] - h[i, j]), abs(h[min(i + 1, n), j] - h[i, j])) / (lin[1] - lin[0])
        y = float(h[i, j])
        if slope > 0.8:
            if rng.random() < 0.35:
                out.append(['rock' if rng.random() < 0.6 else 'rock_b', round(x, 2), round(y - 0.3, 2), round(z, 2),
                            round(float(rng.random() * 6.28), 3), round(float(0.7 + rng.random() * 1.1), 2)])
        elif rng.random() < 0.55 and fbm(np.array([x]), np.array([z]), seed=11)[0] > -0.35:
            out.append(['pine', round(x, 2), round(y - 0.2, 2), round(z, 2), round(float(rng.random() * 6.28), 3),
                        round(float(0.7 + rng.random() * 0.7), 2)])
        if len(out) >= 1600:
            break
    return out


def main():
    tid = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv and len(sys.argv) > sys.argv.index('--') + 1 else 'jp_touge'
    spec = json.load(open(os.path.join(scene.ART, 'specs', 'track', f'{tid}.json'), encoding='utf-8'))
    half = math.ceil(spec['groundSize'] / 2 / TILE) * TILE
    lin, h, edge = grid(spec, half)
    scene.reset()
    mat = bpy.data.materials.new('dressing')  # без текстуры: атлас клиент берёт из dressing.glb
    root = scene.empty(f'terrain_{tid}')
    per = int(round(TILE / STEP))
    k = int(round(COL_STEP / STEP))
    nt = int(round(2 * half / TILE))
    tiles = []
    tris = 0
    for ti in range(nt):
        for tj in range(nt):
            i0, j0 = ti * per, tj * per
            name = f'terrain_{tj - nt // 2}_{ti - nt // 2}'
            o = scene.mesh_object(name, tile_mesh(lin, h, edge, i0, i0 + per, j0, j0 + per), root, [mat])
            scene.mesh_object(f'{name}_collision', tile_mesh(lin, h, edge, i0, i0 + per, j0, j0 + per, k), root, [mat])
            tris += len(o.data.polygons) * 2
            tiles.append(name)
    export.glb(root, os.path.join(scene.ART, 'export', 'tracks', f'terrain_{tid}.glb'))
    inst = scatter(spec, lin, h, edge)
    with open(os.path.join(scene.ART, 'export', 'tracks', f'terrain_{tid}.json'), 'w', encoding='utf-8') as f:
        json.dump({'id': tid, 'tile': TILE, 'tiles': tiles, 'instances': inst}, f)
    print(f'TERRAIN {tid}: {len(tiles)} блоков, {tris} тр., {len(inst)} деревьев и скал')
    scene.save_blend(os.path.join(scene.ART, 'source', 'tracks', f'terrain_{tid}.blend'))


if __name__ == '__main__':
    main()
