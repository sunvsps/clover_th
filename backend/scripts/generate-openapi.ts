// Usage: npx tsx scripts/generate-openapi.ts [--check]
// Writes openapi/openapi.json and openapi/schema.d.ts (openapi-typescript output for the frontend).
// --check fails when the committed files differ from what the routes produce.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';

const dir = new URL('../openapi/', import.meta.url);

export async function generate() {
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://x:x@localhost:5432/x?connection_limit=1&pool_timeout=1',
    SESSION_SECRET: 'x'.repeat(32),
    DISCORD_CLIENT_ID: 'x',
    DISCORD_CLIENT_SECRET: 'x',
    DISCORD_REDIRECT_URI: 'http://localhost/cb',
    FRONTEND_URL: 'http://localhost:5173',
    BOT_API_KEYS: 'a'.repeat(64),
  });
  const app = await buildApp({ env });
  await app.ready();
  const spec = app.swagger();
  await app.close();
  const json = JSON.stringify(spec, null, 2) + '\n';
  const types = astToString(await openapiTS(spec as never));
  return { spec, json, types };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { json, types } = await generate();
  const jsonUrl = new URL('openapi.json', dir);
  const typesUrl = new URL('schema.d.ts', dir);
  if (process.argv.includes('--check')) {
    const [a, b] = await Promise.all([
      readFile(jsonUrl, 'utf8').catch(() => ''),
      readFile(typesUrl, 'utf8').catch(() => ''),
    ]);
    if (a !== json || b !== types) {
      console.error('openapi/ is out of date. Run: npm run openapi');
      process.exit(1);
    }
    console.log('openapi: up to date');
  } else {
    await writeFile(jsonUrl, json);
    await writeFile(typesUrl, types);
    console.log('openapi: written');
  }
}
