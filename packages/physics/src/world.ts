import type { BuiltTrack } from '@sr/shared';
import type { Rapier } from './rapier';
import type { World } from '@dimforge/rapier3d-compat';
import { levelGeometry, yawPitchQuat, type LevelGeometry } from './level';

export interface PhysicsLevel {
  world: World;
  geometry: LevelGeometry;
  /** Хэндлы коллайдеров стен — для событий удара. */
  wallHandles: Set<number>;
}

export const GROUP_STATIC = 0x0001;
export const GROUP_CAR = 0x0002;

/** Группы коллизий Rapier: (membership << 16) | filter. */
export const groups = (member: number, filter: number) => (member << 16) | filter;

export function createLevel(R: Rapier, track: BuiltTrack, wallFriction = 0.0): PhysicsLevel {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const geometry = levelGeometry(track);
  const ground = world.createRigidBody(R.RigidBodyDesc.fixed());
  const wallHandles = new Set<number>();
  for (const b of geometry.boxes) {
    const d = R.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
      .setTranslation(b.x, b.y, b.z)
      .setRotation(yawPitchQuat(b.yaw, b.pitch ?? 0))
      .setCollisionGroups(groups(GROUP_STATIC, 0xffff))
      .setFriction(b.kind === 'wall' ? wallFriction : 0.9)
      .setRestitution(0);
    const col = world.createCollider(d, ground);
    if (b.kind === 'wall') wallHandles.add(col.handle);
  }
  if (geometry.road) {
    const d = R.ColliderDesc.trimesh(
      new Float32Array(geometry.road.vertices),
      new Uint32Array(geometry.road.indices),
    )
      .setCollisionGroups(groups(GROUP_STATIC, 0xffff))
      .setFriction(0.9);
    world.createCollider(d, ground);
  }
  for (const w of geometry.wedges) {
    const d = R.ColliderDesc.convexHull(new Float32Array(w.vertices));
    if (!d) continue;
    d.setCollisionGroups(groups(GROUP_STATIC, 0xffff)).setFriction(0.9);
    world.createCollider(d, ground);
  }
  return { world, geometry, wallHandles };
}
