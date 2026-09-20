import type { Env } from '../../../config/env.js';
import type { NotificationProvider } from '../types.js';
import { BotProvider } from './bot.js';
import { fakeProvider } from './fake.js';

export function createProvider(env: Env): NotificationProvider | null {
  if (env.NOTIFICATIONS_PROVIDER === 'off') return null;
  if (env.NOTIFICATIONS_PROVIDER === 'fake') return fakeProvider;
  return new BotProvider({ url: env.DISCORD_BOT_NOTIFY_URL!, secret: env.DISCORD_BOT_NOTIFY_SECRET! });
}
