/**
 * glTF-машины из Блендера (docs/BLENDER_PLAN.md). Этап B0: загрузка модели по
 * флагу `?carModel=<id>` вместо процедурного кузова. Полный загрузчик с LOD,
 * китами по сокетам и шейдером краски — задачи 9.1–9.2 из PLAN_V2.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export const WHEEL_NODES = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'] as const;
export const BRAKE_NODES = ['brake_FL', 'brake_FR', 'brake_RL', 'brake_RR'] as const;

const cache = new Map<string, Promise<THREE.Object3D>>();
let loader: GLTFLoader | null = null;

/** id модели из адреса (`?carModel=test_rig`); только [a-z0-9_]. */
export function carModelParam(search = location.search): string | null {
  const id = new URLSearchParams(search).get('carModel');
  return id && /^[a-z0-9_]{1,40}$/.test(id) ? id : null;
}

export function loadCarModel(id: string): Promise<THREE.Object3D> {
  let p = cache.get(id);
  if (!p) {
    loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    p = loader.loadAsync(`${import.meta.env.BASE_URL}cars/${id}/base.glb`).then((g) => g.scene);
    cache.set(id, p);
  }
  return p;
}

export interface CarModelParts {
  /** car_root без колёс и тормозов, только LOD0; начало — на земле между осями. */
  body: THREE.Object3D;
  /** Колёса FL, FR, RL, RR: начало — в оси вращения. */
  wheels: THREE.Object3D[];
  /** Тормоза в тех же осях (не вращаются). */
  brakes: (THREE.Object3D | null)[];
  /** Материал задних фонарей — для стоп-сигнала. */
  tailMaterial: THREE.MeshStandardMaterial | null;
}

/** Разобрать копию модели на кузов и колёса (геометрия и материалы общие с кэшем). */
export function splitCarModel(scene: THREE.Object3D): CarModelParts {
  const copy = scene.clone(true);
  const root = copy.getObjectByName('car_root') ?? copy;
  root.updateMatrixWorld(true);
  // LOD1/LOD2 пока не используются (переключение по расстоянию — задача 9.1)
  const lods: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (/_LOD[12]$/.test(o.name)) lods.push(o);
  });
  for (const o of lods) o.removeFromParent();

  const center = (o: THREE.Object3D) =>
    new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  const detach = (o: THREE.Object3D, c: THREE.Vector3) => {
    // После сжатия у узла может быть сдвиг/масштаб квантования — переносим так,
    // чтобы ось вращения (центр колеса) оказалась в начале координат
    o.removeFromParent();
    o.position.sub(c);
    const g = new THREE.Group();
    g.add(o);
    return g;
  };
  const wheels: THREE.Object3D[] = [];
  const brakes: (THREE.Object3D | null)[] = [];
  WHEEL_NODES.forEach((name, i) => {
    const w = root.getObjectByName(name);
    if (!w) throw new Error(`в модели нет ${name}`);
    const c = center(w);
    const b = root.getObjectByName(BRAKE_NODES[i]!);
    wheels.push(detach(w, c));
    brakes.push(b ? detach(b, c) : null);
  });
  let tailMaterial: THREE.MeshStandardMaterial | null = null;
  const tail = root.getObjectByName('lights_rear');
  tail?.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m instanceof THREE.MeshStandardMaterial) tailMaterial = m.clone();
    if (tailMaterial && (o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = tailMaterial;
  });
  return { body: root, wheels, brakes, tailMaterial };
}
