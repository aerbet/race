import { initPhysics } from '@sr/physics';
import { BRAND, getCar, getTrack } from '@sr/shared';
import { getQuality } from './render/quality';
import { FpsCounter } from './render/fps';
import { InputManager } from './input/input';
import { Session } from './game/session';
import { InputDebug } from './ui/input-debug';

async function boot() {
  document.title = BRAND.title;
  const app = document.getElementById('app')!;
  const quality = getQuality();
  const R = await initPhysics();
  const input = new InputManager(app);
  const params = new URLSearchParams(location.search);
  const track = getTrack('polygon');
  const s = new Session(R, track, quality, app, input);
  s.addCar(getCar(params.get('car') ?? 'era2000_coupe'), 0, { player: true });
  const fps = new FpsCounter(app);
  const dbg = params.has('debug') ? new InputDebug(app, input) : null;
  s.hooks.frame = (dt) => {
    fps.tick(dt, quality.name);
    dbg?.update();
  };
  input.touch.show(input.device === 'touch');
  s.start();
  (window as unknown as { __session: Session }).__session = s;
}

boot();
