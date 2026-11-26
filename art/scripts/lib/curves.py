"""Кривые профиля машины: монотонная кубическая интерполяция (без «перелётов»).

Одни и те же функции используют силуэт (silhouette.py) и генератор кузова (build_car.py),
поэтому схема силуэта и модель совпадают.
"""

import math


class Curve:
    """Кривая по ключевым точкам [(u, значение), ...], u возрастает (Фриц — Карлсон)."""

    def __init__(self, pts):
        self.x = [float(p[0]) for p in pts]
        self.y = [float(p[1]) for p in pts]
        n = len(pts)
        d = [(self.y[i + 1] - self.y[i]) / (self.x[i + 1] - self.x[i]) for i in range(n - 1)]
        m = [0.0] * n
        m[0], m[-1] = d[0], d[-1]
        for i in range(1, n - 1):
            m[i] = 0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2
        for i in range(n - 1):
            if d[i] == 0:
                m[i] = m[i + 1] = 0.0
                continue
            a, b = m[i] / d[i], m[i + 1] / d[i]
            s = a * a + b * b
            if s > 9:
                t = 3 / math.sqrt(s)
                m[i], m[i + 1] = t * a * d[i], t * b * d[i]
        self.m = m

    def __call__(self, u):
        x, y, m = self.x, self.y, self.m
        if u <= x[0]:
            return y[0]
        if u >= x[-1]:
            return y[-1]
        i = max(k for k in range(len(x) - 1) if x[k] <= u)
        h = x[i + 1] - x[i]
        t = (u - x[i]) / h
        h00 = 2 * t ** 3 - 3 * t ** 2 + 1
        h10 = t ** 3 - 2 * t ** 2 + t
        h01 = -2 * t ** 3 + 3 * t ** 2
        h11 = t ** 3 - t ** 2
        return h00 * y[i] + h10 * h * m[i] + h01 * y[i + 1] + h11 * h * m[i + 1]


def superellipse(a, b, n, steps=48, start=0.0, end=2 * math.pi):
    """Точки суперэллипса |x/a|^n + |y/b|^n = 1 от угла start до end."""
    pts = []
    for k in range(steps + 1):
        t = start + (end - start) * k / steps
        c, s = math.cos(t), math.sin(t)
        pts.append((a * math.copysign(abs(c) ** (2 / n), c), b * math.copysign(abs(s) ** (2 / n), s)))
    return pts


class CarShape:
    """Форма машины из спецификации: все размеры в метрах, u — доля длины от носа (0) к корме (1)."""

    def __init__(self, spec):
        d = spec['dimensions']
        p = spec['profile']
        self.spec = spec
        self.L, self.W, self.H = d['length'], d['width'], d['height']
        self.wb = d['wheelbase']
        self.R = d['wheelDiameter'] / 2
        self.clear = d['groundClearance']
        self.top_f = Curve(p['side'])
        self.bot_f = Curve(p['bottom'])
        self.plan_f = Curve(p['plan'])
        self.sec = p['section']
        self.gh = spec['greenhouse']
        fo = d.get('frontOverhang', (self.L - self.wb) / 2)
        self.u_front = fo / self.L
        self.u_rear = (fo + self.wb) / self.L
        self.track = {'front': d['trackFront'], 'rear': d['trackRear']}
        self.arch = spec['arches']

    def top(self, u):
        return self.top_f(u) * self.H

    def bottom_raw(self, u):
        return self.bot_f(u) * self.H

    def bottom(self, u):
        """Нижняя кромка кузова с вырезами колёсных арок."""
        z = self.bottom_raw(u)
        for axle, uc in (('front', self.u_front), ('rear', self.u_rear)):
            r = self.arch[axle]['radius']
            dx = (u - uc) * self.L
            if abs(dx) < r:
                z = max(z, self.R + math.sqrt(r * r - dx * dx))
        return z

    def half_width(self, u):
        return self.plan_f(u) * self.W / 2

    def window_z(self):
        return self.gh['windowLine'] * self.H

    def shoulder_z(self):
        zb, zw = self.clear, self.window_z()
        return zb + (zw - zb) * self.sec['shoulder']
