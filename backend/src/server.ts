import { buildApp } from './app.js';
import { EnvError, loadEnv } from './config/env.js';
import { createSweeper } from './modules/auctions/sweeper.js';
import { createProvider } from './modules/notifications/providers/index.js';
import { createWorker } from './modules/notifications/worker.js';

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  const app = await buildApp({ env });
  const sweeper = createSweeper({ prisma: app.prisma, tx: app.tx, log: app.log });
  sweeper.start();
  app.addHook('onClose', () => sweeper.stop());
  const provider = createProvider(env);
  if (provider) {
    const worker = createWorker({ prisma: app.prisma, provider, log: app.log });
    worker.start();
    app.addHook('onClose', () => worker.stop());
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const)
    process.on(sig, () => void app.close().then(() => process.exit(0)));
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
