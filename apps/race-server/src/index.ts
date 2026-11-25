import { initPhysics } from '@sr/physics';
import { startServer } from './server';

const R = await initPhysics();
startServer(R, {
  port: Number(process.env.PORT ?? 2567),
  net: {
    latency: Number(process.env.NET_LAG ?? 0),
    jitter: Number(process.env.NET_JITTER ?? 0),
    loss: Number(process.env.NET_LOSS ?? 0) / 100,
  },
  botFillSeconds: process.env.BOT_FILL ? Number(process.env.BOT_FILL) : undefined,
});
