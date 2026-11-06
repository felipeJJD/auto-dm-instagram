import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeCall = {
  method: string;
  path: string;
  query: Record<string, string>;
  authorization?: string;
  body: any;
};

/** Meta falsa: imita os endpoints da spec, grava as chamadas e deixa `follows` configurável. */
export async function startFakeMeta(opts: { version?: string } = {}) {
  const version = opts.version ?? 'v27.0';
  const calls: FakeCall[] = [];
  const state = { follows: false, failWith: null as { status: number; body: unknown } | null };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const raw = Buffer.concat(chunks).toString('utf8');
      calls.push({
        method: req.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        authorization: req.headers.authorization,
        body: raw ? JSON.parse(raw) : undefined,
      });
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (state.failWith) return reply(state.failWith.status, state.failWith.body);
      const parts = url.pathname.split('/').filter(Boolean); // [v27.0, id, ...]
      if (parts[0] !== version) return reply(404, { error: { message: 'versão desconhecida', code: 100 } });
      if (req.method === 'POST' && parts[2] === 'replies') return reply(200, { id: `reply_${calls.length}` });
      if (req.method === 'POST' && parts[2] === 'messages') {
        return reply(200, { recipient_id: 'x', message_id: `mid_${calls.length}` });
      }
      if (req.method === 'GET' && parts[2] === 'media') return reply(200, { data: [] });
      if (req.method === 'GET' && parts.length === 2) {
        return reply(200, { username: 'pessoa_teste', is_user_follow_business: state.follows });
      }
      reply(404, { error: { message: 'rota desconhecida', code: 100 } });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${version}`;
  return {
    base,
    calls,
    state,
    close: () => new Promise<void>((r) => server.close(() => r())),
    reset: () => {
      calls.length = 0;
    },
  };
}
