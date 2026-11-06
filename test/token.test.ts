import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { createTokenStore, decrypt, encrypt } from '../src/token.ts';
import { getSetting, setSetting } from '../src/store.ts';

test('encrypt/decrypt ida e volta; secret errado lança', () => {
  const blob = encrypt('abc', 's');
  assert.notEqual(blob, 'abc');
  assert.equal(decrypt(blob, 's'), 'abc');
  assert.throws(() => decrypt(blob, 'outro'));
  assert.notEqual(encrypt('abc', 's'), blob, 'IV aleatório');
});

function setup(now: { t: Date }) {
  const calls: string[] = [];
  const f = (async (url: any, init: any = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url} ${init.headers?.Authorization ?? ''}`);
    return new Response(JSON.stringify({ access_token: 'novo', token_type: 'bearer', expires_in: 5184000 }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  return { calls, f, now: () => now.t };
}

test('get usa META_ACCESS_TOKEN quando não há token guardado; null sem nada', async () => {
  const db = await createTestDb();
  const now = { t: new Date('2026-11-05T10:00:00Z') };
  const s = setup(now);
  const a = createTokenStore({ db, cfg: loadConfig({ META_APP_SECRET: 's', META_ACCESS_TOKEN: 'inicial', META_GRAPH_BASE: 'https://graph.instagram.com/v27.0' }), fetch: s.f, now: s.now });
  assert.equal(await a.get(), 'inicial');
  const b = createTokenStore({ db, cfg: loadConfig({ META_APP_SECRET: 's' }), fetch: s.f, now: s.now });
  assert.equal(await b.get(), null);
  assert.equal(await b.refreshIfDue(), false);
  assert.equal(s.calls.length, 0);
});

test('refreshIfDue renova, grava cifrado e não repete no mesmo dia', async () => {
  const db = await createTestDb();
  const now = { t: new Date('2026-11-05T10:00:00Z') };
  const s = setup(now);
  const cfg = loadConfig({
    META_APP_SECRET: 's',
    META_ACCESS_TOKEN: 'inicial',
    META_GRAPH_BASE: 'https://graph.example/v27.0',
  });
  const store = createTokenStore({ db, cfg, fetch: s.f, now: s.now });
  assert.equal(await store.refreshIfDue(), true);
  assert.equal(s.calls.length, 1);
  assert.match(s.calls[0], /^GET https:\/\/graph\.example\/refresh_access_token\?grant_type=ig_refresh_token Bearer inicial$/);
  const raw = await getSetting(db, 'ig_token');
  assert.ok(raw && raw !== 'novo');
  assert.equal(decrypt(raw, 's'), 'novo');
  assert.equal(await store.get(), 'novo');

  now.t = new Date('2026-11-05T20:00:00Z');
  assert.equal(await store.refreshIfDue(), false);
  assert.equal(s.calls.length, 1);

  now.t = new Date('2026-11-13T10:00:00Z');
  assert.equal(await store.refreshIfDue(), true);
  assert.equal(s.calls.length, 2);
  assert.match(s.calls[1], /Bearer novo$/);
});

test('falha no refresh lança erro e mantém o token atual', async () => {
  const db = await createTestDb();
  const f = (async () => new Response(JSON.stringify({ error: { code: 190, message: 'expirado' } }), { status: 400 })) as unknown as typeof fetch;
  const store = createTokenStore({
    db,
    cfg: loadConfig({ META_APP_SECRET: 's', META_ACCESS_TOKEN: 'inicial', META_GRAPH_BASE: 'https://graph.instagram.com/v27.0' }),
    fetch: f,
    now: () => new Date('2026-11-05T10:00:00Z'),
  });
  await assert.rejects(store.refreshIfDue(), /190/);
  assert.equal(await store.get(), 'inicial');
  await setSetting(db, 'x', 'y');
});

test('graph.facebook.com (login unificado, token de usuário do sistema): não tenta renovar', async () => {
  const db = await createTestDb();
  const s = setup({ t: new Date('2026-11-05T10:00:00Z') });
  const cfg = loadConfig({
    META_APP_SECRET: 's',
    META_ACCESS_TOKEN: 'EAAsistema',
    META_GRAPH_BASE: 'https://graph.facebook.com/v27.0',
  });
  const store = createTokenStore({ db, cfg, fetch: s.f, now: s.now });
  assert.equal(await store.refreshIfDue(), false);
  assert.equal(s.calls.length, 0);
  assert.equal(await store.get(), 'EAAsistema');
});

const GRAPH = 'https://graph.example/v27.0';

test('META_ACCESS_TOKEN trocado no env vence o token do banco, substitui e é renovado na hora', async () => {
  const db = await createTestDb();
  const now = { t: new Date('2026-11-05T10:00:00Z') };
  const s = setup(now);
  const cfgA = loadConfig({ META_APP_SECRET: 's', META_ACCESS_TOKEN: 'inicial', META_GRAPH_BASE: GRAPH });
  const a = createTokenStore({ db, cfg: cfgA, fetch: s.f, now: s.now });
  await a.refreshIfDue();
  assert.equal(await a.get(), 'novo');
  assert.equal(await a.get(), 'novo', 'mesmo env: o token renovado do banco continua valendo');

  const cfgB = loadConfig({ META_APP_SECRET: 's', META_ACCESS_TOKEN: 'trocado', META_GRAPH_BASE: GRAPH });
  const b = createTokenStore({ db, cfg: cfgB, fetch: s.f, now: s.now });
  assert.equal(await b.get(), 'trocado');
  assert.equal(decrypt((await getSetting(db, 'ig_token'))!, 's'), 'trocado');
  assert.equal(await b.get(), 'trocado');

  now.t = new Date('2026-11-05T10:05:00Z');
  assert.equal(await b.refreshIfDue(), true, 'token novo do env não herda a data da renovação anterior');
  assert.match(s.calls.at(-1)!, /Bearer trocado$/);
  assert.equal(await b.get(), 'novo');
});

test('banco legado sem registro da origem mantém o token do banco; depois, trocar o env vence', async () => {
  const db = await createTestDb();
  const s = setup({ t: new Date('2026-11-05T10:00:00Z') });
  const cfgA = loadConfig({ META_APP_SECRET: 's', META_ACCESS_TOKEN: 'inicial', META_GRAPH_BASE: GRAPH });
  await createTokenStore({ db, cfg: cfgA, fetch: s.f, now: s.now }).refreshIfDue();
  await db.query(`delete from settings where key not in ('ig_token', 'ig_token_refreshed_at')`);
  assert.equal(await createTokenStore({ db, cfg: cfgA, fetch: s.f, now: s.now }).get(), 'novo');

  const cfgB = loadConfig({ META_APP_SECRET: 's', META_ACCESS_TOKEN: 'trocado', META_GRAPH_BASE: GRAPH });
  assert.equal(await createTokenStore({ db, cfg: cfgB, fetch: s.f, now: s.now }).get(), 'trocado');
});

test('decrypt falha (secret mudou): usa o env, loga sem vazar valores; sem env devolve null', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const db = await createTestDb();
  const s = setup({ t: new Date('2026-11-05T10:00:00Z') });
  const cfg = loadConfig({ META_APP_SECRET: 's', META_ACCESS_TOKEN: 'valor-do-env', META_GRAPH_BASE: GRAPH });
  await createTokenStore({ db, cfg, fetch: s.f, now: s.now }).refreshIfDue();
  await setSetting(db, 'ig_token', encrypt('valor-do-banco', 'outro-secret'));

  const store = createTokenStore({ db, cfg, fetch: s.f, now: s.now });
  assert.equal(await store.get(), 'valor-do-env');
  assert.ok(log.mock.callCount() >= 1);
  const logged = log.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
  assert.match(logged, /ig_token/);
  assert.ok(!logged.includes('valor-do-env') && !logged.includes('valor-do-banco'));

  const semEnv = createTokenStore({ db, cfg: loadConfig({ META_APP_SECRET: 's', META_GRAPH_BASE: GRAPH }), fetch: s.f, now: s.now });
  assert.equal(await semEnv.get(), null);
});
