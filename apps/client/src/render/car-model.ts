/**
 * glTF-машины из Блендера (docs/BLENDER_PLAN.md, PLAN_V2 9.1).
 *
 * Сборка: базовая модель `cars/<id>/base.glb` + кузовной кит `cars/<id>/kit_<kit>.glb`
 * (узлы `<часть>__<kit>` заменяют hood, bumper_front, bumper_rear, skirts, spoiler;
 * спойлер — по сокету `socket_spoiler`). Каждая часть — THREE.LOD из LOD0/1/2.
 * Загрузки кэшируются: геометрия и материалы общие у всех машин одной модели.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export const WHEEL_NODES = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'] as const;
export const BRAKE_NODES = ['brake_FL', 'brake_FR', 'brake_RL', 'brake_RR'] as const;
export const KIT_PARTS = ['hood', 'bumper_front', 'bumper_rear', 'skirts', 'spoiler'] as const;
/** Расстояния переключения LOD1 и LOD2 (м до камеры). */
export const LOD_DISTANCES = [0, 22, 55] as const;

const cache = new Map<string, Promise<THREE.Object3D>>();
let loader: GLTFLoader | null = null;

/** id модели из адреса (`?carModel=test_rig`); только [a-z0-9_]. */
export function carModelParam(search = location.search): string | null {
  const id = new URLSearchParams(search).get('carModel');
  return id && /^[a-z0-9_]{1,40}$/.test(id) ? id : null;
}

/** Кит из адреса (`?carKit=track`) — проверка китов без гаража. */
export function carKitParam(search = location.search): string | null {
  const id = new URLSearchParams(search).get('carKit');
  return id && /^[a-z0-9_]{1,40}$/.test(id) ? id : null;
}

function load(path: string): Promise<THREE.Object3D> {
  let p = cache.get(path);
  if (!p) {
    loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    p = loader.loadAsync(`${import.meta.env.BASE_URL}${path}`).then((g) => g.scene);
    // Ошибка не кэшируется навсегда: следующая попытка загрузит заново
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

export const loadCarModel = (id: string) => load(`cars/${id}/base.glb`);
export const loadCarKit = (id: string, kit: string) => load(`cars/${id}/kit_${kit}.glb`);

/** Базовое имя материала: `paint__track` → `paint` (маска покраски по слотам, см. kits.py). */
export const materialRole = (name: string) => name.split('__')[0]!;

export interface CarModelParts {
  /** car_root без колёс и тормозов; части — THREE.LOD; начало — на земле между осями. */
  body: THREE.Object3D;
  /** Колёса FL, FR, RL, RR (LOD): начало — в оси вращения. */
  wheels: THREE.Object3D[];
  /** Тормоза в тех же осях (не вращаются). */
  brakes: (THREE.Object3D | null)[];
  /** Материал задних фонарей — для стоп-сигнала. */
  tailMaterial: THREE.MeshStandardMaterial | null;
  /** Какой кит реально стоит (null — сток или кит не загрузился). */
  kit: string | null;
}

const lodName = (name: string) => /^(.*)_LOD([12])$/.exec(name);

/**
 * Свернуть узлы `<имя>`, `<имя>_LOD1`, `<имя>_LOD2` (дети parent) в THREE.LOD с именем `<имя>`.
 * LOD встаёт на место LOD0 и забирает его трансформацию.
 */
export function groupLods(parent: THREE.Object3D): void {
  const byBase = new Map<string, THREE.Object3D[]>();
  for (const c of [...parent.children]) {
    const m = lodName(c.name);
    const base = m ? m[1]! : c.name;
    const level = m ? Number(m[2]) : 0;
    const arr = byBase.get(base) ?? [];
    arr[level] = c;
    byBase.set(base, arr);
  }
  for (const [base, levels] of byBase) {
    if (!levels[1] && !levels[2]) continue;
    const lod = new THREE.LOD();
    lod.name = base;
    parent.add(lod);
    levels.forEach((o, i) => {
      if (!o) return;
      o.removeFromParent();
      o.name = `${base}${i ? `_LOD${i}` : ''}`;
      lod.addLevel(o, LOD_DISTANCES[i]);
    });
  }
}

/**
 * Поставить кит: узлы `<часть>__<kit>` из сцены кита заменяют стоковые части базы.
 * Возвращает false, если в ките нет нужных узлов (тогда база не трогается).
 */
export function applyKit(root: THREE.Object3D, kitScene: THREE.Object3D, kit: string): boolean {
  const kitRoot = kitScene.getObjectByName(`kit_${kit}`) ?? kitScene;
  const found = KIT_PARTS.map((p) => kitRoot.getObjectByName(`${p}__${kit}`));
  if (found.some((o) => !o)) return false;
  for (const p of KIT_PARTS)
    for (const s of ['', '_LOD1', '_LOD2']) root.getObjectByName(p + s)?.removeFromParent();
  kitRoot.updateMatrixWorld(true);
  // Сокет: спойлер кита собран в точке socket_spoiler своей машины; ставим его в сокет базы
  const baseSocket = root.getObjectByName('socket_spoiler');
  const kitSocket = kitRoot.getObjectByName(`socket_spoiler__${kit}`);
  const shift =
    baseSocket && kitSocket
      ? baseSocket.position.clone().sub(kitSocket.position)
      : new THREE.Vector3();
  for (const p of KIT_PARTS)
    for (const s of ['', '_LOD1', '_LOD2']) {
      const o = kitRoot.getObjectByName(`${p}__${kit}${s}`);
      if (!o) continue;
      const c = o.clone(true);
      c.name = p + s;
      if (p === 'spoiler') c.position.add(shift);
      root.add(c);
    }
  return true;
}

/** Разобрать копию модели (+ кит) на кузов и колёса (геометрия и материалы общие с кэшем). */
export function splitCarModel(
  scene: THREE.Object3D,
  kitScene?: THREE.Object3D | null,
  kit?: string | null,
): CarModelParts {
  const copy = scene.clone(true);
  const root = copy.getObjectByName('car_root') ?? copy;
  const kitOk = !!(kitScene && kit && applyKit(root, kitScene, kit));
  root.updateMatrixWorld(true);

  const center = (o: THREE.Object3D) =>
    new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  // Колёса и тормоза: в группу с началом в оси вращения, LOD внутри группы
  const detach = (name: string, c: THREE.Vector3) => {
    const g = new THREE.Group();
    for (const s of ['', '_LOD1', '_LOD2']) {
      const o = root.getObjectByName(name + s);
      if (!o) continue;
      // После сжатия у узла может быть сдвиг/масштаб квантования — переносим так,
      // чтобы ось вращения (центр колеса) оказалась в начале координат
      o.removeFromParent();
      o.position.sub(c);
      g.add(o);
    }
    if (!g.children.length) return null;
    groupLods(g);
    return g;
  };
  const wheels: THREE.Object3D[] = [];
  const brakes: (THREE.Object3D | null)[] = [];
  WHEEL_NODES.forEach((name, i) => {
    const w = root.getObjectByName(name);
    if (!w) throw new Error(`в модели нет ${name}`);
    const c = center(w);
    wheels.push(detach(name, c)!);
    brakes.push(detach(BRAKE_NODES[i]!, c));
  });
  groupLods(root);

  let tailMaterial: THREE.MeshStandardMaterial | null = null;
  const tail = root.getObjectByName('lights_rear');
  tail?.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!tailMaterial && m instanceof THREE.MeshStandardMaterial) tailMaterial = m.clone();
    if (tailMaterial && (o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = tailMaterial;
  });
  return { body: root, wheels, brakes, tailMaterial, kit: kitOk ? kit! : null };
}

/** Габариты кузова (LOD0 body) в осях Блендера: x — ширина, y — длина, z — высота. */
export function bodyBox(root: THREE.Object3D): THREE.Box3 | null {
  const body = root.getObjectByName('body');
  const lod0 = body instanceof THREE.LOD ? body.levels[0]?.object : body;
  if (!lod0) return null;
  const g = (lod0 as THREE.Mesh).geometry;
  if (!g) return null;
  g.computeBoundingBox();
  return g.boundingBox!.clone().applyMatrix4(lod0.matrix);
}
