"""Карты трасс для меню (BLENDER_PLAN 7.3): вид сверху в стиле игры — тёмный фон, улицы района
тусклыми линиями, трасса — светящаяся линия, старт — точка.

Запуск: pnpm art:track maps  (сначала pnpm track:export all)
Вход: art/specs/track/<id>.json → apps/client/public/maps/<id>.png (512²).
Рисуется numpy (сглаженные линии + свечение размытием), Блендер только сохраняет PNG.
"""

import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import scene  # noqa: E402

N = 512
BG = np.array([0.035, 0.04, 0.07])
ROAD = np.array([0.16, 0.18, 0.24])
TRACK = np.array([0.16, 0.88, 1.0])
START = np.array([1.0, 0.17, 0.84])


def stroke(canvas, pts, width, color, alpha=1.0):
    """Линия-ломаная толщиной width px: расстояние до отрезков на сетке (для 512² — быстро)."""
    ys, xs = np.mgrid[0:N, 0:N].astype(np.float32)
    mask = np.zeros((N, N), np.float32)
    for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
        x0, x1 = int(max(min(ax, bx) - width - 2, 0)), int(min(max(ax, bx) + width + 2, N))
        y0, y1 = int(max(min(ay, by) - width - 2, 0)), int(min(max(ay, by) + width + 2, N))
        if x1 <= x0 or y1 <= y0:
            continue
        px, py = xs[y0:y1, x0:x1], ys[y0:y1, x0:x1]
        dx, dy = bx - ax, by - ay
        ll = dx * dx + dy * dy or 1.0
        t = np.clip(((px - ax) * dx + (py - ay) * dy) / ll, 0, 1)
        d = np.hypot(px - ax - t * dx, py - ay - t * dy)
        cov = np.clip(width / 2 + 0.5 - d, 0, 1)  # сглаживание края
        mask[y0:y1, x0:x1] = np.maximum(mask[y0:y1, x0:x1], cov)
    a = (mask * alpha)[..., None]
    canvas[:] = canvas * (1 - a) + color * a
    return mask


def blur(m, r):
    """Размытие прямоугольником три раза ≈ гаусс."""
    k = 2 * r + 1
    for _ in range(3):
        c = np.cumsum(np.pad(m, ((0, 0), (r + 1, r))), axis=1)
        m = (c[:, k:] - c[:, :-k]) / k
        c = np.cumsum(np.pad(m, ((r + 1, r), (0, 0))), axis=0)
        m = (c[k:] - c[:-k]) / k
    return m


def render(spec):
    xs = [s[0] for s in spec['samples']]
    zs = [s[2] for s in spec['samples']]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    span = max(max(xs) - min(xs), max(zs) - min(zs)) * 1.18 + 40
    k = N / span

    def to_px(x, z):
        return ((x - cx) * k + N / 2, (z - cz) * k + N / 2)

    img = np.ones((N, N, 3)) * BG
    # лёгкая сетка, как на экране навигатора
    img[::32, :] += 0.02
    img[:, ::32] += 0.02
    for r in spec.get('roads', []):
        stroke(img, [to_px(x, z) for x, z in r['points']], max(1.5, r['width'] * k * 0.6), ROAD)
    path = [to_px(s[0], s[2]) for s in spec['samples']]
    if spec['closed']:
        path.append(path[0])
    core = stroke(np.zeros_like(img), path, 4.0, TRACK)
    glow = blur(core, 6) * 1.4
    img += glow[..., None] * TRACK * 0.8
    stroke(img, path, 3.2, TRACK)
    stroke(img, path, 1.2, np.array([0.85, 1.0, 1.0]))
    sx, sy = path[0]
    stroke(img, [(sx - 0.01, sy), (sx + 0.01, sy)], 13, START)
    stroke(img, [(sx - 0.01, sy), (sx + 0.01, sy)], 5, np.array([1.0, 1.0, 1.0]))
    return np.clip(img, 0, 1)


def save_png(arr, path):
    rgba = np.concatenate([arr[::-1], np.ones((N, N, 1))], axis=2).astype(np.float32)
    im = bpy.data.images.new(os.path.basename(path), N, N, alpha=False)
    im.pixels.foreach_set(rgba.ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


def main():
    src = os.path.join(scene.ART, 'specs', 'track')
    out = os.path.join(scene.REPO, 'apps', 'client', 'public', 'maps')
    os.makedirs(out, exist_ok=True)
    for f in sorted(os.listdir(src)):
        if not f.endswith('.json'):
            continue
        spec = json.load(open(os.path.join(src, f), encoding='utf-8'))
        p = os.path.join(out, f'{spec["id"]}.png')
        save_png(render(spec), p)
        print(f'MAP {p}')


if __name__ == '__main__':
    main()
