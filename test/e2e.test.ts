import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createTestDb } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import * as store from '../src/store.ts';
import { createApp } from '../src/server.ts';
import { drainWebhooks } from '../src/http/webhook.ts';
import { createMetaClient } from '../src/meta.ts';
import { createTokenStore } from '../src/token.ts';
import { processOutbox } from '../src/outbox.ts';
import { importAutomations } from '../scripts/importar.ts';
import { startFakeMeta } from './fake-meta.ts';

const MEDIA_ID = '17900000000000001';
const SECRET = 'segredo-e2e';
const IG = '17841400000000099';
const exportJson = JSON.parse(readFileSync(new URL('../data/exemplo-automacoes.json', import.meta.url), 'utf8'));

const closers: Array<() => unknown> = [];
after(() => {
  for (const c of closers) c();
});

async function boot() {
  const fake = await startFakeMeta();
  closers.push(fake.close);
  const db = await createTestDb();
  const cfg = loadConfig({
    META_APP_SECRET: SECRET,
    META_VERIFY_TOKEN: 'vt',
    META_ACCESS_TOKEN: 'tok-teste',
    META_GRAPH_BASE: fake.base,
    PUBLIC_BASE_URL: 'https://app.test',
    IG_USER_ID: IG,
    SEND_ENABLED: 'true',
  });
  const tokens = createTokenStore({ db, cfg });
  const meta = createMetaClient({ base: cfg.graphBase, igUserId: cfg.igUserId, getToken: () => tokens.get() });
  const app: Server = createApp({ db, cfg, meta, tokens });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  closers.push(() => app.close());
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;

  await importAutomations(db, exportJson);
  const auto = (await store.listAutomations(db)).find((a) => a.media_id === MEDIA_ID)!;
  await store.setActive(db, auto.id, true);

  const webhook = async (payload: unknown) => {
    const raw = JSON.stringify(payload);
    const sig = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
    const r = await fetch(`${base}/webhook`, { method: 'POST', body: raw, headers: { 'X-Hub-Signature-256': sig } });
    assert.equal(r.status, 200);
    await drainWebhooks();
    await processOutbox({ db, meta, cfg }, 20);
  };
  return { fake, db, cfg, base, webhook, auto };
}

const commentEvent = (id: string, from: string, text = 'quero!') => ({
  object: 'instagram',
  entry: [
    {
      id: IG,
      time: 1,
      changes: [{ field: 'comments', value: { id, text, from: { id: from, username: 'pessoa_teste' }, media: { id: MEDIA_ID, media_product_type: 'REELS' } } }],
    },
  ],
});

const postbackEvent = (from: string, payload: string, mid: string) => ({
  object: 'instagram',
  entry: [
    {
      id: IG,
      time: 2,
      messaging: [{ sender: { id: from }, recipient: { id: IG }, timestamp: Date.now(), postback: { mid, title: 'x', payload } }],
    },
  ],
});

test('ponta a ponta: comentário → resposta pública → DM com botão → checa seguir → link → clique', async () => {
  const { fake, db, base, webhook, auto } = await boot();

  // 1. comentário
  await webhook(commentEvent('cmt_1', 'user_1'));
  const reply = fake.calls.find((c) => c.path.endsWith('/cmt_1/replies'));
  assert.ok(reply, 'resposta pública enviada');
  assert.equal(reply.method, 'POST');
  assert.equal(reply.authorization, 'Bearer tok-teste');
  assert.ok(exportJson.defaults.public_replies.includes(reply.body.message));
  const priv = fake.calls.find((c) => c.path === `/v27.0/${IG}/messages`);
  assert.ok(priv, 'private reply enviada');
  assert.deepEqual(priv.body.recipient, { comment_id: 'cmt_1' });
  const run = (await db.query('select * from runs')).rows[0];
  assert.equal(run.state, 'welcome_sent');
  const welcomeBtn = priv.body.message.attachment.payload.elements[0].buttons[0];
  assert.deepEqual(welcomeBtn, { type: 'postback', title: auto.welcome_button, payload: `FC:${run.id}` });

  // 2. clique, não segue → pede para seguir
  fake.reset();
  fake.state.follows = false;
  await webhook(postbackEvent('user_1', `FC:${run.id}`, 'mid_a'));
  assert.equal(fake.calls[0].method, 'GET');
  assert.equal(fake.calls[0].path, '/v27.0/user_1');
  assert.equal(fake.calls[0].query.fields, 'username,is_user_follow_business');
  const ask = fake.calls.find((c) => c.method === 'POST')!;
  assert.deepEqual(ask.body.recipient, { id: 'user_1' });
  const askEl = ask.body.message.attachment.payload.elements[0];
  assert.equal(askEl.title, exportJson.defaults.ask_follow_text);
  assert.equal(askEl.buttons[0].title, exportJson.defaults.ask_follow_button);
  assert.equal(askEl.buttons[0].payload, `FC:${run.id}`);
  assert.equal((await store.getRun(db, run.id))?.state, 'asked_follow');

  // 3. clique de novo, agora segue → DM do link
  fake.reset();
  fake.state.follows = true;
  await webhook(postbackEvent('user_1', `FC:${run.id}`, 'mid_b'));
  const link = fake.calls.find((c) => c.method === 'POST')!;
  const linkBtn = link.body.message.attachment.payload.elements[0].buttons[0];
  assert.deepEqual(linkBtn, {
    type: 'web_url',
    url: `https://app.test/r/${run.id}-${run.click_token}`,
    title: auto.link_button,
  });
  assert.equal((await store.getRun(db, run.id))?.state, 'link_sent');

  // 4. clique no link (sem o token, 404)
  assert.equal((await fetch(`${base}/r/${run.id}`, { redirect: 'manual' })).status, 404);
  const r = await fetch(`${base}/r/${run.id}-${run.click_token}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://exemplo.com/guia');
  assert.equal((await store.getRun(db, run.id))?.link_clicks, 1);

  // tudo que saiu foi enviado, nada preso na fila
  assert.deepEqual(await store.outboxSummary(db), { pending: 0, failed: 0 });
});

test('comentário da própria conta não gera chamada à Meta', async () => {
  const { fake, db, webhook } = await boot();
  await webhook(commentEvent('cmt_self', IG, 'Te mandei na DM!'));
  assert.equal(fake.calls.length, 0);
  assert.equal((await db.query('select 1 from runs')).rows.length, 0);
  assert.equal((await db.query('select 1 from outbox')).rows.length, 0);
});

test('Meta reenvia o mesmo webhook e a pessoa comenta de novo → uma só DM', async () => {
  const { fake, webhook } = await boot();
  await webhook(commentEvent('cmt_1', 'user_1'));
  await webhook(commentEvent('cmt_1', 'user_1'));
  await webhook(commentEvent('cmt_2', 'user_1', 'de novo'));
  assert.equal(fake.calls.filter((c) => c.path.endsWith('/messages')).length, 1);
  assert.equal(fake.calls.filter((c) => c.path.endsWith('/replies')).length, 1);
});

test('token expirado (Graph 190): item vira failed com erro legível e o servidor segue de pé', async () => {
  const { fake, db, base, webhook } = await boot();
  fake.state.failWith = { status: 400, body: { error: { code: 190, message: 'Error validating access token' } } };
  await webhook(commentEvent('cmt_1', 'user_1'));
  const failed = (await db.query(`select last_error from outbox where status = 'failed'`)).rows;
  assert.equal(failed.length, 2);
  assert.match(failed[0].last_error, /190/);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
});
