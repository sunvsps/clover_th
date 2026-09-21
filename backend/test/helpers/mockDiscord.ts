import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type MockDiscord = {
  url: string;
  /** Codes the mock will accept, mapped to the Discord user id they represent. */
  registerCode: (code: string, discordId: string) => void;
  tokenRequests: URLSearchParams[];
  close: () => Promise<void>;
};

export const MOCK_CLIENT_ID = 'test-client-id';
export const MOCK_CLIENT_SECRET = 'test-client-secret-value';
export const MOCK_REDIRECT_URI = 'http://localhost:5173/api/v1/auth/discord/callback';

export async function startMockDiscord(): Promise<MockDiscord> {
  const codes = new Map<string, string>();
  const tokenRequests: URLSearchParams[] = [];
  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && req.url === '/api/oauth2/token') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const p = new URLSearchParams(raw);
        tokenRequests.push(p);
        const user = codes.get(p.get('code') ?? '');
        if (
          !user ||
          p.get('grant_type') !== 'authorization_code' ||
          p.get('client_id') !== MOCK_CLIENT_ID ||
          p.get('client_secret') !== MOCK_CLIENT_SECRET ||
          p.get('redirect_uri') !== MOCK_REDIRECT_URI
        ) {
          return send(400, { error: 'invalid_grant' });
        }
        send(200, { access_token: `tok-${p.get('code')}`, token_type: 'Bearer' });
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/api/users/@me') {
      const code = (req.headers.authorization ?? '').replace(/^Bearer tok-/, '');
      const id = codes.get(code);
      return id ? send(200, { id, username: 'mock' }) : send(401, { message: '401: Unauthorized' });
    }
    send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    registerCode: (code, id) => void codes.set(code, id),
    tokenRequests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
