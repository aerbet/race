"""Кузов машины: лофт поперечных сечений по кривым спецификации (lib/curves.CarShape).

Сечение (правая половина, от середины днища к середине крыши):
  A — нижняя четверть суперэллипса: днище → плечо (самое широкое место);
  B — скругление плеча внутрь до «полки» у линии окон;
  C — кабина: боковина с завалом (tumblehome) и плоская крыша со скруглёнными углами.
Вне кабины (капот, багажник) высота C равна нулю — получается плоская крышка.
Арки колёс — подъём нижней кромки по дуге (сквозная ниша), как на схеме силуэта.

Оси Блендера: нос по +Y, верх +Z; начало — на земле между осями.
"""

import math

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from lib.curves import CarShape

NA, NB, NC = 10, 6, 14  # точек в сегментах сечения (правая половина)
KS = 8  # строк кабины C до верхней кромки боковых окон (дальше — крыша)
T_SIDE_TOP = 0.82


def smooth(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


class Body:
    def __init__(self, spec):
        self.s = CarShape(spec)
        s = self.s
        self.spec = spec
        self.u_mid = (s.u_front + s.u_rear) / 2
        g = spec['greenhouse']
        self.g = g
        # Станции: равномерно + сгущение у носа и кормы
        n = 110
        us = set(round(k / n, 5) for k in range(n + 1))
        us.update(round(x, 5) for x in (0.003, 0.008, 0.015, 0.025, 0.985, 0.992, 0.997))
        # Станции точно по границам стёкол и стоек — края окон ровные
        self.ua, self.uq = g['windshieldBase'] + 0.035, g['roofRear'] + 0.045
        self.ub = g.get('bPillar', 0.6)
        self.u_door = g.get('doorFront', 0.335)
        for x in (g['windshieldBase'], g['roofFront'], g['roofRear'], g['backlightBase'], self.ua, self.uq,
                  self.ub - 0.007, self.ub + 0.007):
            us.add(round(x, 5))
        us = sorted(us)
        # убрать станции ближе 3 мм друг к другу
        self.us = [u for i, u in enumerate(us) if i == 0 or (u - us[i - 1]) * spec['dimensions']['length'] > 0.003]

    # ---- координаты ----
    def y(self, u):
        return (self.u_mid - u) * self.s.L

    def u_of_y(self, y):
        return self.u_mid - y / self.s.L

    def gfac(self, u):
        """1 — зона кабины, 0 — капот/багажник."""
        g = self.g
        return smooth(g['windshieldBase'] - 0.03, g['windshieldBase'], u) * \
            (1 - smooth(g['backlightBase'], g['backlightBase'] + 0.025, u))

    def flare(self, u):
        s = self.s
        out = 0.0
        for axle, uc in (('front', s.u_front), ('rear', s.u_rear)):
            r = s.arch[axle]['radius'] / s.L
            k = abs(u - uc) / (r * 1.5)
            if k < 1:
                out += s.arch[axle]['flare'] * (0.5 + 0.5 * math.cos(k * math.pi))
        return out

    def bulge(self, u, x):
        """Силовой горб капота."""
        b = self.spec.get('hood', {})
        if b.get('style') != 'power_bulge_slots':
            return 0.0
        ws = self.g['windshieldBase']
        return 0.032 * smooth(0.06, 0.1, u) * (1 - smooth(ws - 0.07, ws - 0.01, u)) * (1 - smooth(0.18, 0.27, abs(x)))

    def kick(self, u):
        """Подъём нижней кромки заднего бокового окна («кик»)."""
        g = self.g
        u_k0, u_k1 = g['roofRear'] - 0.03, self.uq - 0.01
        return g['quarterKick'] * self.s.H * smooth(u_k0, u_k1, u)

    def section(self, u):
        """Правая половина сечения: список (x, z, сегмент, строка).

        Строка: A — −2, B — −1, последняя точка B — 0, C — 1..NC (1 — нижняя кромка окна,
        KS — верхняя кромка боковых окон, NC — середина крыши).
        """
        s = self.s
        gf = self.gfac(u)
        zt = s.top(u)
        zb = s.bottom(u)
        a = s.half_width(u) + self.flare(u)
        tb = s.sec['tumblehome']
        n = s.sec['exponent']
        zw_e = zt + (min(s.window_z(), zt) - zt) * gf
        zw_e = max(zw_e, zb + 0.06)
        zs_e = min(s.shoulder_z(), zb + 0.72 * (zw_e - zb))
        g0 = a * (1 - tb * 0.45) - 0.03
        g1 = g0 + (a * (1 - tb * 1.3) - g0) * gf
        pts = []
        # A: днище → плечо
        for k in range(NA):
            t = k / (NA - 1)
            ang = -math.pi / 2 + t * math.pi / 2
            c, sn = math.cos(ang), math.sin(ang)
            pts.append((a * abs(c) ** (2 / n), zs_e - (zs_e - zb) * abs(sn) ** (2 / n), 'A', -2))
        # B: плечо → полка (скругление с центром (g0, zs_e))
        for k in range(1, NB + 1):
            t = k / NB
            ang = t * math.pi / 2
            c, sn = math.cos(ang), math.sin(ang)
            pts.append((g0 + (a - g0) * c ** (2 / 7.0), zs_e + (zw_e - zs_e) * sn ** (2 / 7.0), 'B',
                        0 if k == NB else -1))
        # C: кабина (или плоская крышка капота/багажника)
        hc = zt - zw_e
        t_bot = min(0.3, (0.022 + self.kick(u)) / hc) if hc > 0.05 else 1 / NC
        for k in range(1, NC + 1):
            if k <= KS:
                t = t_bot + (T_SIDE_TOP - t_bot) * (k - 1) / (KS - 1)
            else:
                t = T_SIDE_TOP + (1 - T_SIDE_TOP) * (k - KS) / (NC - KS)
            corner = (1 - t ** 6) ** (1 / 6)
            # вне кабины крышка плоская: точки равномерно по ширине (без слипания у края)
            x = g0 * (1 - t) + ((g0 + (g1 - g0) * t) * corner - g0 * (1 - t)) * gf
            z = zw_e + (zt - zw_e) * t
            z += self.bulge(u, x)
            pts.append((x, z, 'C', k))
        return pts

    def build(self):
        """Лофт → bmesh. Возвращает (bm, теги граней {face: (u, сегмент, t, сторона)})."""
        bm = bmesh.new()
        bm.faces.layers.int.new('part')  # слой разметки частей (заранее: новый слой делает ссылки на грани недействительными)
        rings = []
        meta = []
        for u in self.us:
            half = self.section(u)
            # полный контур: правая половина + левая (без центральных точек)
            loop = [(x, z, sg, t, 1) for x, z, sg, t in half]
            loop += [(-x, z, sg, t, -1) for x, z, sg, t in reversed(half[1:-1])]
            y = self.y(u)
            rings.append([bm.verts.new((x, y, z)) for x, z, *_ in loop])
            meta.append(loop)
        M = len(rings[0])
        tags = {}
        for i in range(len(rings) - 1):
            u = (self.us[i] + self.us[i + 1]) / 2
            for j in range(M):
                j2 = (j + 1) % M
                f = bm.faces.new((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]))
                _, _, sg, r1, side = meta[i][j]
                r2 = meta[i][j2][3]
                band = min(r1, r2) if r1 >= 0 and r2 >= 0 else -1
                tags[f] = (u, 'C' if band >= 1 else ('F' if band == 0 else sg), band, side)
        # Торцы: перёд и корма
        for idx, u in ((0, 0.0), (-1, 1.0)):
            f = bm.faces.new(rings[idx] if idx == -1 else list(reversed(rings[idx])))
            tags[f] = (u, 'cap', 0.0, 0)
        bm.normal_update()
        # Наружу: проверка по торцу носа (нормаль должна смотреть в +Y)
        cap_front = next(f for f, tg in tags.items() if tg[1] == 'cap' and tg[0] == 0.0)
        if cap_front.normal.y < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
            bm.normal_update()
        self.bvh = BVHTree.FromBMesh(bm)
        return bm, tags

    # ---- проекция на поверхность ----
    def hit(self, origin, direction):
        loc, nrm, _, _ = self.bvh.ray_cast(Vector(origin), Vector(direction).normalized(), 20.0)
        return loc, nrm

    def project(self, pts2d, view):
        """Точки контура на поверхность: view = front (x, z), rear (x, z), side_r/side_l (u, z), top (x, u)."""
        out = []
        for p in pts2d:
            if view == 'front':
                o, d = (p[0], 10.0, p[1]), (0, -1, 0)
            elif view == 'rear':
                o, d = (p[0], -10.0, p[1]), (0, 1, 0)
            elif view in ('side_r', 'side_l'):
                sx = 1 if view == 'side_r' else -1
                o, d = (sx * 10.0, self.y(p[0]), p[1]), (-sx, 0, 0)
            else:  # top
                o, d = (p[0], self.y(p[1]), 10.0), (0, 0, -1)
            loc, nrm = self.hit(o, d)
            out.append((loc, nrm) if loc is not None else (None, None))
        return out
