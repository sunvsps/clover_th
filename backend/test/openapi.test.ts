import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generate } from '../scripts/generate-openapi.js';
import { routes } from './authz/routes.js';

describe('OpenAPI', () => {
  it('committed openapi/openapi.json and schema.d.ts match what the routes generate', async () => {
    const { json, types } = await generate();
    expect(await readFile(new URL('../openapi/openapi.json', import.meta.url), 'utf8')).toBe(json);
    expect(await readFile(new URL('../openapi/schema.d.ts', import.meta.url), 'utf8')).toBe(types);
  });

  it('every route except /docs/json is documented', async () => {
    const { spec } = await generate();
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    for (const r of routes.filter((x) => x.pattern !== '/docs/json')) {
      const openapiPath = r.pattern.replace(/:(\w+)/g, '{$1}');
      expect(paths[openapiPath]?.[r.method.toLowerCase()], `${r.method} ${r.pattern}`).toBeTruthy();
    }
  });
});
