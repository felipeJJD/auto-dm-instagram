import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createTestDb } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import * as store from '../src/store.ts';
import { createApp } from '../src/server.ts';
import { drainWebhooks } from '../src/http/webhook.ts';
import { escapeHtml } from '../src/http/util.ts';
import type { MetaClient } from '../src/meta.ts';
import { sampleAutomation } from './helpers.ts';

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

const meta: MetaClient = {
  async replyToComment() {},
  async sendPrivateReply() {},
  async sendMessage() {},
  async getFollowStatus() {
    return { follows: false };
  },
  async listMedia() {
    return [];
  },
  async getAccount() {
    return { id: '999', username: 'teste' };
  },
  async getSubscribedFields() {
    return [];
  },
  async subscribeApp() {},
};

async function start(env: Record<string, string> = {}, wrapDb: (db: Db) => Db = (db) => db) {
  const real = await createTestDb();
  const db = wrapDb(real);
  const cfg = loadConfig({ META_APP_SECRET: 'segredo-de-teste', META_VERIFY_TOKEN: 'vt', IG_USER_ID: '999', ...env });
  const app = createApp({ db, cfg, meta, tokens: { get: async () => null } });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  servers.push(app);
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  return { db: real, cfg, base };
}

const sign = (raw: string, secret = 'segredo-de-teste') => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

const commentBody = JSON.stringify({
  object: 'instagram',
  entry: [{ id: '999', changes: [{ field: 'comments', value: { id: 'c1', text: 'oi', from: { id: 'u1' }, media: { id: 'm1' } } }] }],
});

test('GET /healthz → {ok:true}', async () => {
  const { base } = await start();
  const r = await fetch(`${base}/healthz`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('GET /privacidade → página pública com política e instruções de exclusão (exigida para publicar o app)', async () => {
  const { base } = await start();
  const r = await fetch(`${base}/privacidade`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/html/);
  const html = await r.text();
  assert.match(html, /Política de Privacidade/);
  assert.match(html, /id="exclusao"/);
  assert.equal((await fetch(`${base}/privacidade`, { method: 'POST' })).status, 404);
});

test('GET /privacidade usa BRAND_NAME e IG_USERNAME (escapados); sem @ fala da conta de forma genérica', async () => {
  const { base } = await start({ BRAND_NAME: 'Loja <Ana>', IG_USERNAME: '@loja_ana' });
  const html = await (await fetch(`${base}/privacidade`)).text();
  assert.match(html, /Loja &lt;Ana&gt;/);
  assert.match(html, /href="https:\/\/www\.instagram\.com\/loja_ana\/"/);
  assert.doesNotMatch(html, /o nosso perfil/);
  const { base: b2 } = await start();
  const generic = await (await fetch(`${b2}/privacidade`)).text();
  assert.match(generic, /Auto DM/);
  assert.doesNotMatch(generic, /instagram\.com\/\//);
});

test('GET /webhook: verify token certo devolve hub.challenge; errado 403', async () => {
  const { base } = await start();
  const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=12345`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '12345');
  const bad = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`);
  assert.equal(bad.status, 403);
});

test('GET /webhook sem META_VERIFY_TOKEN configurado → 403 mesmo com token vazio', async () => {
  const { base } = await start({ META_VERIFY_TOKEN: '' });
  const r = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=1`);
  assert.equal(r.status, 403);
});

test('POST /webhook sem assinatura ou com assinatura errada → 401 e nada gravado', async () => {
  const { base, db } = await start();
  const a = await fetch(`${base}/webhook`, { method: 'POST', body: commentBody });
  assert.equal(a.status, 401);
  const b = await fetch(`${base}/webhook`, {
    method: 'POST',
    body: commentBody,
    headers: { 'X-Hub-Signature-256': sign(commentBody, 'outro') },
  });
  assert.equal(b.status, 401);
  const c = await fetch(`${base}/webhook`, {
    method: 'POST',
    body: commentBody,
    headers: { 'X-Hub-Signature-256': 'sha256=zz' },
  });
  assert.equal(c.status, 401);
  assert.equal((await db.query('select 1 from webhook_events')).rows.length, 0);
});

test('POST /webhook com META_APP_SECRET vazio → 401 (nunca aceita)', async () => {
  const { base } = await start({ META_APP_SECRET: '' });
  const r = await fetch(`${base}/webhook`, {
    method: 'POST',
    body: commentBody,
    headers: { 'X-Hub-Signature-256': sign(commentBody, '') },
  });
  assert.equal(r.status, 401);
});

test('POST /webhook assinado → 200 EVENT_RECEIVED, evento gravado; repetido não duplica outbox', async () => {
  const { base, db } = await start();
  const aid = await store.saveAutomation(db, sampleAutomation());
  await store.setActive(db, aid, true);
  const post = () =>
    fetch(`${base}/webhook`, { method: 'POST', body: commentBody, headers: { 'X-Hub-Signature-256': sign(commentBody) } });
  const r = await post();
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'EVENT_RECEIVED');
  await drainWebhooks();
  assert.equal((await db.query('select 1 from webhook_events')).rows.length, 1);
  assert.equal((await db.query('select 1 from outbox')).rows.length, 2);
  await post();
  await drainWebhooks();
  assert.equal((await db.query('select 1 from outbox')).rows.length, 2);
});

const eventInsert = /insert into webhook_events/;

test('POST /webhook: o evento já está gravado quando o 200 sai (gravação lenta não é ultrapassada)', async () => {
  const slow = (db: Db): Db => ({
    async query(sql, params) {
      if (eventInsert.test(sql)) await new Promise((r) => setTimeout(r, 150));
      return db.query(sql, params);
    },
  });
  const { base, db } = await start({}, slow);
  const r = await fetch(`${base}/webhook`, { method: 'POST', body: commentBody, headers: { 'X-Hub-Signature-256': sign(commentBody) } });
  assert.equal(r.status, 200);
  assert.equal((await db.query('select 1 from webhook_events')).rows.length, 1, 'sem drainWebhooks: já gravado');
  await drainWebhooks();
});

test('POST /webhook: falha de banco ao gravar o evento → 500 (a Meta reenvia); o reenvio é processado', async () => {
  const flaky = { down: true };
  const wrap = (db: Db): Db => ({
    query(sql, params) {
      if (flaky.down && eventInsert.test(sql)) return Promise.reject(new Error('banco fora'));
      return db.query(sql, params);
    },
  });
  const { base, db } = await start({}, wrap);
  const aid = await store.saveAutomation(db, sampleAutomation());
  await store.setActive(db, aid, true);
  const post = () =>
    fetch(`${base}/webhook`, { method: 'POST', body: commentBody, headers: { 'X-Hub-Signature-256': sign(commentBody) } });

  const down = await post();
  assert.equal(down.status, 500);
  await drainWebhooks();
  assert.equal((await db.query('select 1 from webhook_events')).rows.length, 0);
  assert.equal((await db.query('select 1 from outbox')).rows.length, 0);

  flaky.down = false;
  assert.equal((await post()).status, 200);
  await drainWebhooks();
  assert.equal((await db.query('select 1 from outbox')).rows.length, 2);
});

test('POST /webhook: erro ao processar um item não vira 500 e fica pendente para a varredura', async () => {
  const { base, db } = await start();
  const aid = await store.saveAutomation(db, sampleAutomation({ welcome_text: 'x'.repeat(161) }));
  await store.setActive(db, aid, true);
  const r = await fetch(`${base}/webhook`, { method: 'POST', body: commentBody, headers: { 'X-Hub-Signature-256': sign(commentBody) } });
  assert.equal(r.status, 200);
  await drainWebhooks();
  const ev = (await db.query('select processed_at, error, attempts from webhook_events')).rows[0];
  assert.equal(ev.processed_at, null);
  assert.match(ev.error, /160/);
  assert.equal(ev.attempts, 1);
});

test('POST /webhook acima do limite de corpo → 413', async () => {
  const { base } = await start();
  const big = 'x'.repeat(1_100_000);
  const r = await fetch(`${base}/webhook`, { method: 'POST', body: big, headers: { 'X-Hub-Signature-256': sign(big) } });
  assert.equal(r.status, 413);
});

test('GET /r/<id>-<token> → 302 para link_url e conta clique; /r/abc e id inexistente → 404', async () => {
  const { base, db } = await start();
  const aid = await store.saveAutomation(db, sampleAutomation({ link_url: 'https://destino.test/kit' }));
  const run = (await store.createRun(db, { automationId: aid, igsid: 'u1', commentId: 'c1' }))!;
  const r = await fetch(`${base}/r/${run.id}-${run.click_token}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://destino.test/kit');
  assert.equal((await store.getRun(db, run.id))?.link_clicks, 1);
  assert.equal((await fetch(`${base}/r/abc`, { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(`${base}/r/99999-${run.click_token}`, { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(`${base}/nada`)).status, 404);
});

test('GET /r/<id> sem token ou com token errado → 404 e nenhum clique contado', async () => {
  const { base, db } = await start();
  const aid = await store.saveAutomation(db, sampleAutomation());
  const run = (await store.createRun(db, { automationId: aid, igsid: 'u1', commentId: 'c1' }))!;
  assert.match(run.click_token, /^[0-9a-f]{16}$/);
  const wrong = run.click_token.replace(/./, (c) => (c === '0' ? '1' : '0'));
  for (const tail of [`${run.id}`, `${run.id}-`, `${run.id}-${wrong}`, `${run.id}-${run.click_token}0`]) {
    const r = await fetch(`${base}/r/${tail}`, { redirect: 'manual' });
    assert.equal(r.status, 404, tail);
  }
  assert.equal((await store.getRun(db, run.id))?.link_clicks, 0);
});

test('escapeHtml escapa os cinco caracteres', () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});
