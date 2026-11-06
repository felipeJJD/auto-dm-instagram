import http from 'node:http';
import type { EngineDeps } from './engine.ts';
import type { MetaClient } from './meta.ts';
import { handlePainel } from './http/painel/routes.ts';
import { handlePrivacidade } from './http/privacidade.ts';
import { handleRedirect } from './http/redirect.ts';
import { handleWebhookPost, handleWebhookVerify } from './http/webhook.ts';
import { send, sendJson } from './http/util.ts';

export type AppDeps = EngineDeps & { meta: MetaClient; tokens: { get(): Promise<string | null> } };

export function createApp(d: AppDeps): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method ?? 'GET';

      if (path === '/healthz' && method === 'GET') {
        await d.db.query('select 1');
        return sendJson(res, 200, { ok: true });
      }
      if (path === '/webhook') {
        if (method === 'GET') return handleWebhookVerify(url, res, d);
        if (method === 'POST') return await handleWebhookPost(req, res, d);
        return send(res, 405, 'method not allowed');
      }
      if (path === '/privacidade' && method === 'GET') return handlePrivacidade(res, d.cfg);
      const r = /^\/r\/([^/]+)$/.exec(path);
      if (r && (method === 'GET' || method === 'HEAD')) return await handleRedirect(req, res, d, r[1]);
      if (path === '/painel' || path.startsWith('/painel/')) {
        if (await handlePainel(req, res, d)) return;
      }
      send(res, 404, 'não encontrado');
    } catch (e) {
      console.error('erro no servidor:', (e as Error).message);
      send(res, 500, 'erro interno');
    }
  });
}
