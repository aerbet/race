"""Атлас города (BLENDER_PLAN 6.1): полосы фасадов, ночные окна, витрины — одна текстура 2048².

Атлас рисуется процедурно (numpy, детерминированный сид), а не запекается из шейдерных нод:
результат тот же (картинка-полоса), но без рендера и одинаковый на любой машине.

Раскладка (строки сверху вниз, каждая 256 px = один этаж ~3 м; по горизонтали полосы
бесшовные, 2048 px = 12 м, поэтому стены используют повтор по U):
  0 штукатурка бежевая · 1 штукатурка светлая · 2 кирпич красный · 3 кирпич песочный
  4 бетонная панель · 5 стеклянная стена · 6 окна (16 ячеек 128×256) · 7 разное:
  карниз (64), ограждение лоджий (64), витрина (128)
Карта свечения — того же расклада в 1024²: светятся только горящие окна и витрины.
"""

import json
import os
import sys

import numpy as np

W = 2048
STRIP = 256
METERS = 12.0  # ширина атласа по U в метрах (стены)
STRIPS = ['plaster_beige', 'plaster_cream', 'brick_red', 'brick_sand', 'panel', 'glass', 'windows', 'misc']
N_WIN = 16
# Окна: 0–3 тёмные, 4–7 тёплый свет, 8–9 холодный, 10 телевизор, 11–12 шторы, 13 тёмное с рамой,
# 14 тёплый с растением, 15 офис (холодный, сплошной)
LIT = {4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15}


def strip_v(name):
    """Диапазон V полосы (v = 0 внизу атласа)."""
    i = STRIPS.index(name)
    top = 1 - i * STRIP / W
    return top - STRIP / W, top


def misc_v(part):
    """Подполосы строки «разное»: cornice | railing | shop."""
    v0, v1 = strip_v('misc')
    h = STRIP / W
    return {'shop': (v0, v0 + h / 2), 'railing': (v0 + h / 2, v0 + h * 0.75), 'cornice': (v0 + h * 0.75, v1)}[part]


def window_uv(cell):
    """Прямоугольник UV ячейки окна cell (0–15)."""
    v0, v1 = strip_v('windows')
    return cell / N_WIN, v0, (cell + 1) / N_WIN, v1


def _noise(rng, h, w, scale, amp):
    """Мягкий шум: случайная сетка, растянутая билинейно (бесшовная по X)."""
    gh, gw = max(2, h // scale), max(2, w // scale)
    g = rng.random((gh + 1, gw))
    g = np.concatenate([g, g[:, :1]], axis=1)  # бесшовно по горизонтали
    ys = np.linspace(0, gh, h, endpoint=False)
    xs = np.linspace(0, gw, w, endpoint=False)
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[np.minimum(y0 + 1, gh)][:, x0]
    d = g[np.minimum(y0 + 1, gh)][:, x0 + 1]
    return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy - 0.5) * amp


def _rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def _fill(img, y0, y1, x0, x1, col):
    img[y0:y1, x0:x1, :3] = col


def plaster(rng, base, h=STRIP):
    s = np.ones((h, W, 3)) * _rgb(base)
    s += _noise(rng, h, W, 24, 0.07)[..., None] + _noise(rng, h, W, 4, 0.03)[..., None]
    s[-10:] *= 0.78  # межэтажный поясок
    s[-14:-10] *= 1.08
    return s


def brick(rng, base, mortar):
    s = np.ones((STRIP, W, 3)) * _rgb(mortar)
    bw, bh = 42, 12  # кирпич 0,25 × 0,07 м при 170 px/м
    for r in range(STRIP // bh + 1):
        off = (r % 2) * bw // 2
        for c in range(-1, W // bw + 1):
            x0 = c * bw + off + 2
            y0 = r * bh + 2
            col = _rgb(base) * (0.85 + rng.random() * 0.3)
            xa, xb = max(x0, 0), min(x0 + bw - 3, W)
            if xb > xa:
                s[y0:min(y0 + bh - 3, STRIP), xa:xb] = col
    s += _noise(rng, STRIP, W, 16, 0.06)[..., None]
    return s


def tiles(rng, base, grout, size=17):
    """Облицовочная плитка (Токио): квадраты ~0,1 м с затиркой."""
    s = np.ones((STRIP, W, 3)) * _rgb(grout)
    for r in range(STRIP // size + 1):
        for c in range(W // size + 1):
            col = _rgb(base) * (0.93 + rng.random() * 0.12)
            s[r * size + 1:min(r * size + size - 1, STRIP), c * size + 1:min(c * size + size - 1, W)] = col
    s += _noise(rng, STRIP, W, 30, 0.08)[..., None]
    s[-10:] *= 0.7
    return s


def panel(rng):
    s = np.ones((STRIP, W, 3)) * _rgb('#9a9a96')
    s += _noise(rng, STRIP, W, 20, 0.08)[..., None] + _noise(rng, STRIP, W, 3, 0.04)[..., None]
    for x in range(0, W, W // 4):  # вертикальные швы панелей каждые 3 м
        s[:, x:x + 5] *= 0.55
    s[-6:] *= 0.55  # горизонтальный шов
    # подтёки под швами
    for x in range(0, W, W // 4):
        s[:-6, x + 5:x + 30] *= 1 - 0.08 * np.linspace(1, 0, STRIP - 6)[:, None, None]
    return s


def glass(rng):
    s = np.ones((STRIP, W, 3)) * _rgb('#1d2a3a')
    grad = np.linspace(0.75, 1.25, STRIP)[:, None, None]
    s *= grad
    s += _noise(rng, STRIP, W, 64, 0.12)[..., None] * np.array([0.6, 0.8, 1.0])
    for x in range(0, W, W // 8):  # стойки каждые 1,5 м
        s[:, x:x + 8] = _rgb('#3c4048')
    s[-12:] = _rgb('#3c4048')  # ригель
    return s


NEON = {11: '#ff3bbd', 12: '#2ef2ff', 10: '#8dff4a'}


def windows(rng, neon=False):
    s = np.zeros((STRIP, W, 3))
    e = np.zeros((STRIP, W, 3))
    cw = W // N_WIN
    warm = [_rgb('#ffd38a'), _rgb('#ffc070'), _rgb('#ffe2a8'), _rgb('#ffb060')]
    for k in range(N_WIN):
        x0 = k * cw
        cell = np.ones((STRIP, cw, 3)) * _rgb('#2a2a2c')  # рама
        g = np.ones((STRIP - 24, cw - 20, 3))
        if k in (0, 1, 2, 3, 13):
            g *= _rgb('#141820') * (0.8 + 0.1 * k % 3)
            g += np.linspace(0.08, 0, STRIP - 24)[:, None, None] * np.array([0.4, 0.5, 0.7])  # отражение неба
            lit = None
        elif k in (4, 5, 6, 7, 14):
            lit = warm[k % 4]
        elif k in (8, 9, 15):
            lit = _rgb('#bfe0ff') if k != 9 else _rgb('#d8ecff')
        elif neon and k in NEON:
            lit = _rgb(NEON[k])  # неоновые вывески (Токио)
        elif k == 10:
            lit = _rgb('#6f8cff')
        else:
            lit = _rgb('#ffcf8a') if k == 11 else _rgb('#cfe3ff')
        if lit is not None:
            # светлое пятно к центру, к краям темнее
            yy = np.linspace(-1, 1, STRIP - 24)[:, None]
            xx = np.linspace(-1, 1, cw - 20)[None, :]
            fall = (1 - 0.35 * (xx ** 2 + yy ** 2))[..., None]
            g = lit * fall
            if neon and k in NEON:
                g = lit * np.ones_like(g) * 1.1
            elif k in (11, 12):  # шторы: вертикальные складки
                g *= (0.7 + 0.3 * np.abs(np.sin(np.linspace(0, 9, cw - 20))))[None, :, None]
            if k == 14:  # растение на подоконнике
                g[-40:, 20:50] *= 0.25
            if k == 10:
                g *= 0.6
        cell[12:-12, 10:-10] = g
        cell[STRIP // 2 - 3:STRIP // 2 + 3, 10:-10] = _rgb('#2a2a2c')  # импост
        if k != 15:
            cell[12:-12, cw // 2 - 3:cw // 2 + 3] = _rgb('#2a2a2c')
        s[:, x0:x0 + cw] = cell
        if lit is not None:
            em = cell.copy()
            em[:12] = em[-12:] = 0
            em[:, :10] = em[:, -10:] = 0
            e[:, x0:x0 + cw] = em
    return s, e


def misc(rng, kit='moscow'):
    s = np.zeros((STRIP, W, 3))
    e = np.zeros((STRIP, W, 3))
    tokyo = kit == 'tokyo'
    # карниз (верхние 64 px): светлый камень с сухариками
    c = np.ones((64, W, 3)) * _rgb('#9aa0a8' if tokyo else '#d8d0bf')
    c += _noise(rng, 64, W, 8, 0.05)[..., None]
    for x in range(0, W, 34):
        c[34:52, x:x + 18] *= 0.72
    c[56:] *= 0.6
    s[:64] = c
    # ограждение лоджий (64 px): бетонный экран с полосой
    r = np.ones((64, W, 3)) * _rgb('#b5b2aa')
    r += _noise(rng, 64, W, 10, 0.06)[..., None]
    r[:6] *= 0.6
    r[28:34] = _rgb('#7d6a5a')
    s[64:128] = r
    # витрина (128 px): тёмная полоса вывески сверху, светлое стекло, переплёты
    v = np.ones((128, W, 3)) * _rgb('#eef6ff' if tokyo else '#ffd59a')  # Токио — яркий магазин 24/7
    v *= np.linspace(0.75, 1.05, 128)[:, None, None]
    v[:22] = _rgb('#121317')
    for x in range(0, W, 256):
        v[22:, x:x + 8] = _rgb('#202228')
        v[60:, x + 170:x + 174] = _rgb('#202228')
    s[128:] = v
    ev = v.copy()
    ev[:22] = 0
    e[128:] = ev * 0.9
    return s, e


def build(seed=11, kit='moscow'):
    """Атлас набора. Имена полос общие; в «Токио» штукатурка и кирпич — облицовочная плитка."""
    rng = np.random.default_rng(seed)
    img = np.zeros((W, W, 3))
    emit = np.zeros((W, W, 3))
    if kit == 'tokyo':
        rows = {
            'plaster_beige': tiles(rng, '#e6e4de', '#b9b6ae'),
            'plaster_cream': tiles(rng, '#8f9399', '#6d7076'),
            'brick_red': tiles(rng, '#5a4436', '#3e3028', 26),
            'brick_sand': tiles(rng, '#cdbb9c', '#a89a80', 26),
            'panel': panel(rng),
            'glass': glass(rng),
        }
    else:
        rows = {
            'plaster_beige': plaster(rng, '#c9b38f'),
            'plaster_cream': plaster(rng, '#ddd2b4'),
            'brick_red': brick(rng, '#8a3f2c', '#b8ada0'),
            'brick_sand': brick(rng, '#c8b99a', '#d8d2c6'),
            'panel': panel(rng),
            'glass': glass(rng),
        }
    for name, s in rows.items():
        i = STRIPS.index(name)
        img[i * STRIP:(i + 1) * STRIP] = s
    s, e = windows(rng, neon=kit == 'tokyo')
    i = STRIPS.index('windows')
    img[i * STRIP:(i + 1) * STRIP] = s
    emit[i * STRIP:(i + 1) * STRIP] = e
    s, e = misc(rng, kit)
    i = STRIPS.index('misc')
    img[i * STRIP:(i + 1) * STRIP] = s
    emit[i * STRIP:(i + 1) * STRIP] = e
    return np.clip(img, 0, 1), np.clip(emit, 0, 1)


def save(arr, path, size, quality=88):
    """numpy (верх — первая строка) → JPEG через Блендер."""
    import bpy
    a = arr
    if a.shape[0] != size:
        k = a.shape[0] // size
        a = a.reshape(size, k, size, k, 3).mean(axis=(1, 3))
    h, w, _ = a.shape
    rgba = np.concatenate([a[::-1], np.ones((h, w, 1))], axis=2).astype(np.float32)
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    img.pixels.foreach_set(rgba.ravel())
    sc = bpy.context.scene
    st = sc.render.image_settings
    st.file_format, st.color_mode, st.quality = 'JPEG', 'RGB', quality
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save_render(path, scene=sc)
    st.file_format, st.color_mode = 'PNG', 'RGBA'
    bpy.data.images.remove(img)
    return path


def layout():
    """Описание раскладки для документации и клиента."""
    return {
        'size': W, 'metersU': METERS, 'strips': {n: strip_v(n) for n in STRIPS if n not in ('windows', 'misc')},
        'windows': [window_uv(k) for k in range(N_WIN)], 'lit': sorted(LIT),
        'misc': {k: misc_v(k) for k in ('cornice', 'railing', 'shop')},
    }


if __name__ == '__main__':
    kit = sys.argv[sys.argv.index('--kit') + 1] if '--kit' in sys.argv else 'moscow'
    out = os.path.join(os.path.dirname(__file__), '..', '..', 'export', 'city', kit)
    a, e = build(kit=kit)
    save(a, os.path.join(out, 'atlas.jpg'), 2048)
    save(e, os.path.join(out, 'atlas_emit.jpg'), 1024)
    json.dump(layout(), open(os.path.join(out, 'atlas.json'), 'w'), indent=1)
