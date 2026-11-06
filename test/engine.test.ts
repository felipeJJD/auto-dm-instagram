import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import * as store from '../src/store.ts';
import { handleComment, handleFollowCheck, handleMessaging, handleWebhookBody, reprocessPending } from '../src/engine.ts';
import type { EngineDeps } from '../src/engine.ts';
import { sampleAutomation } from './helpers.ts';

async function setup(opts: { follows?: boolean | Error; auto?: Parameters<typeof sampleAutomation>[0]; style?: string } = {}) {
  const db = await createTestDb();
  const cfg = loadConfig({ IG_USER_ID: '999', PUBLIC_BASE_URL: 'https://app.test', BUTTON_STYLE: opts.style });
  const state = { follows: opts.follows ?? false, checks: 0 };
  const meta = {
    async getFollowStatus(_igsid: string) {
      state.checks++;
      if (state.follows instanceof Error) throw state.follows;
      return { follows: state.follows, username: 'ana' };
    },
  };
  const d: EngineDeps = { db, cfg, meta, random: () => 0, now: () => new Date() };
  const aid = await store.saveAutomation(db, sampleAutomation(opts.auto));
  await store.setActive(db, aid, true);
  return { db, d, aid, state };
}

const comment = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  text: 'eu quero',
  from: { id: 'u1', username: 'ana' },
  media: { id: 'm1' },
  ...over,
});

async function outbox(db: Awaited<ReturnType<typeof createTestDb>>) {
  return (await db.query('select * from outbox order by id')).rows;
}

test('comentário do próprio IG_USER_ID → ignored (sem laço)', async () => {
  const { d, db } = await setup();
  assert.equal(await handleComment(d, comment({ from: { id: '999' } })), 'ignored');
  assert.equal((await outbox(db)).length, 0);
});

test('resposta (parent_id) com include_replies false → ignored; true → started', async () => {
  const off = await setup({ auto: { include_replies: false } });
  assert.equal(await handleComment(off.d, comment({ parent_id: 'p1' })), 'ignored');
  const on = await setup();
  assert.equal(await handleComment(on.d, comment({ parent_id: 'p1' })), 'started');
});

test('sem automação ativa / mídia diferente / inativa → ignored', async () => {
  const { d, db, aid } = await setup();
  assert.equal(await handleComment(d, comment({ media: { id: 'outra' } })), 'ignored');
  await store.setActive(db, aid, false);
  assert.equal(await handleComment(d, comment()), 'ignored');
});

test('modo keywords: emoji, vazio e sem palavra → ignored; com palavra → started', async () => {
  const { d } = await setup({ auto: { trigger_mode: 'keywords', keywords: ['Pegar'] } });
  assert.equal(await handleComment(d, comment({ id: 'a', text: '🔥' })), 'ignored');
  assert.equal(await handleComment(d, comment({ id: 'b', text: undefined })), 'ignored');
  assert.equal(await handleComment(d, comment({ id: 'c', text: 'pegár!' })), 'started');
});

test('caminho feliz: started, comment_reply sorteado e private_reply com FC:<id>', async () => {
  const { d, db } = await setup();
  assert.equal(await handleComment(d, comment()), 'started');
  const rows = await outbox(db);
  assert.deepEqual(rows.map((r) => r.kind), ['comment_reply', 'private_reply']);
  assert.deepEqual(rows[0].payload, { commentId: 'c1', message: 'a' });
  const run = (await db.query('select * from runs')).rows[0];
  assert.equal(run.state, 'welcome_sent');
  assert.equal(run.igsid, 'u1');
  assert.equal(rows[1].run_id, run.id);
  const btn = rows[1].payload.message.attachment.payload.elements[0].buttons[0];
  assert.deepEqual(btn, { type: 'postback', title: 'Clique', payload: `FC:${run.id}` });
  assert.equal(rows[1].payload.commentId, 'c1');
  const contact = (await db.query('select username from contacts where igsid = $1', ['u1'])).rows[0];
  assert.equal(contact.username, 'ana');
});

test('sorteio usa random: último índice', async () => {
  const { d, db } = await setup();
  d.random = () => 0.99;
  await handleComment(d, comment());
  assert.equal((await outbox(db))[0].payload.message, 'b');
});

test('mesmo autor de novo (outro comentário) → skipped, sem itens novos', async () => {
  const { d, db } = await setup();
  await handleComment(d, comment());
  const before = (await outbox(db)).length;
  assert.equal(await handleComment(d, comment({ id: 'c2' })), 'skipped');
  assert.equal((await outbox(db)).length, before);
});

test('run undelivered: novo comentário da pessoa reaproveita o run (novo comment_id) e reenvia', async () => {
  const { d, db } = await setup();
  await handleComment(d, comment());
  const before = (await db.query('select * from runs')).rows[0];
  await store.markRunUndelivered(db, before.id);
  const n = (await outbox(db)).length;

  assert.equal(await handleComment(d, comment({ id: 'c2' })), 'started');
  const runs = (await db.query('select * from runs')).rows;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, before.id);
  assert.equal(runs[0].comment_id, 'c2');
  assert.equal(runs[0].state, 'welcome_sent');
  assert.equal(runs[0].click_token, before.click_token);
  const added = (await outbox(db)).slice(n);
  assert.deepEqual(added.map((r) => r.kind), ['comment_reply', 'private_reply']);
  assert.equal(added[0].payload.commentId, 'c2');
  assert.equal(added[1].payload.commentId, 'c2');
  assert.equal(added[1].run_id, before.id);
  assert.equal(added[1].payload.message.attachment.payload.elements[0].buttons[0].payload, `FC:${before.id}`);
});

test('run undelivered: o mesmo comment_id de novo, ou run já avançado, → skipped', async () => {
  const { d, db } = await setup();
  await handleComment(d, comment());
  const run = (await db.query('select * from runs')).rows[0];
  await store.markRunUndelivered(db, run.id);
  const n = (await outbox(db)).length;
  assert.equal(await handleComment(d, comment()), 'skipped');
  assert.equal((await store.getRun(db, run.id))?.state, 'undelivered');

  for (const state of ['asked_follow', 'link_sent'] as const) {
    await store.setRunState(db, run.id, state);
    assert.equal(await handleComment(d, comment({ id: `novo-${state}` })), 'skipped');
    assert.equal((await store.getRun(db, run.id))?.state, state);
  }
  assert.equal((await outbox(db)).length, n);
});

test('run undelivered: falha ao enfileirar o reenvio devolve o run a undelivered e a Meta pode reenviar', async () => {
  const { d, db } = await setup();
  await handleComment(d, comment());
  const run = (await db.query('select * from runs')).rows[0];
  await store.markRunUndelivered(db, run.id);
  const n = (await outbox(db)).length;

  let failNext = true;
  const flaky = {
    query(sql: string, params?: unknown[]) {
      if (failNext && /insert into outbox/.test(sql) && params?.[0] === 'private_reply') {
        failNext = false;
        return Promise.reject(new Error('banco caiu'));
      }
      return db.query(sql, params);
    },
  };
  await assert.rejects(handleComment({ ...d, db: flaky }, comment({ id: 'c2' })), /banco caiu/);
  const after = (await db.query('select * from runs')).rows[0];
  assert.equal(after.state, 'undelivered');
  assert.equal(after.comment_id, 'c1');
  assert.equal((await outbox(db)).length, n, 'comment_reply enfileirado na tentativa também some');

  assert.equal(await handleComment({ ...d, db: flaky }, comment({ id: 'c2' })), 'started');
  assert.equal((await store.getRun(db, run.id))?.state, 'welcome_sent');
});

test('texto de boas-vindas acima de 160 em generic: erro e nenhum run órfão', async () => {
  const { d, db } = await setup({ auto: { welcome_text: 'x'.repeat(161) } });
  await assert.rejects(handleComment(d, comment()));
  assert.equal((await db.query('select 1 from runs')).rows.length, 0);
  assert.equal((await outbox(db)).length, 0);
});

test('postback com follows false → asked_follow + DM com botão Seguindo', async () => {
  const { d, db } = await setup({ follows: false });
  await handleComment(d, comment());
  const run = (await db.query('select id from runs')).rows[0];
  const r = await handleMessaging(d, { sender: { id: 'u1' }, recipient: { id: '999' }, postback: { payload: `FC:${run.id}` } });
  assert.equal(r, 'asked_follow');
  const last = (await outbox(db)).at(-1);
  assert.equal(last.kind, 'message');
  assert.equal(last.payload.igsid, 'u1');
  const el = last.payload.message.attachment.payload.elements[0];
  assert.equal(el.title, 'segue?');
  assert.deepEqual(el.buttons[0], { type: 'postback', title: 'Seguindo', payload: `FC:${run.id}` });
  assert.equal((await store.getRun(db, run.id))?.state, 'asked_follow');
});

test('depois follows true → link_sent + web_url para /r/<id>; novo clique reenvia', async () => {
  const { d, db, state } = await setup({ follows: false });
  await handleComment(d, comment());
  const id = (await db.query('select id from runs')).rows[0].id;
  const click = { sender: { id: 'u1' }, recipient: { id: '999' }, postback: { payload: `FC:${id}` } };
  await handleMessaging(d, click);
  state.follows = true;
  assert.equal(await handleMessaging(d, click), 'link_sent');
  let last = (await outbox(db)).at(-1);
  const btn = last.payload.message.attachment.payload.elements[0].buttons[0];
  const token = (await store.getRun(db, id))!.click_token;
  assert.match(token, /^[0-9a-f]{16}$/);
  assert.deepEqual(btn, { type: 'web_url', url: `https://app.test/r/${id}-${token}`, title: 'Pegar' });
  assert.equal((await store.getRun(db, id))?.state, 'link_sent');
  const n = (await outbox(db)).length;
  assert.equal(await handleMessaging(d, click), 'link_sent');
  assert.equal((await outbox(db)).length, n + 1);
  last = (await outbox(db)).at(-1);
  assert.equal(last.payload.message.attachment.payload.elements[0].buttons[0].type, 'web_url');
  assert.equal((await db.query('select follows from contacts where igsid = $1', ['u1'])).rows[0].follows, true);
});

test('getFollowStatus lança (ex.: consentimento) → asked_follow', async () => {
  const { d, db } = await setup({ follows: new Error('User consent is required') });
  await handleComment(d, comment());
  const id = (await db.query('select id from runs')).rows[0].id;
  assert.equal(await handleFollowCheck(d, id), 'asked_follow');
  assert.equal((await store.getRun(db, id))?.state, 'asked_follow');
});

test('handleFollowCheck com run inexistente → ignored', async () => {
  const { d } = await setup();
  assert.equal(await handleFollowCheck(d, 424242), 'ignored');
});

test('quick reply FC:<id> equivale a postback', async () => {
  const { d, db, state } = await setup({ follows: true });
  await handleComment(d, comment());
  const id = (await db.query('select id from runs')).rows[0].id;
  const r = await handleMessaging(d, {
    sender: { id: 'u1' },
    recipient: { id: '999' },
    message: { text: 'Seguindo', quick_reply: { payload: `FC:${id}` } },
  });
  assert.equal(r, 'link_sent');
  assert.equal(state.checks, 1);
});

test('payload FC de outra pessoa → ignored', async () => {
  const { d, db, state } = await setup();
  await handleComment(d, comment());
  const id = (await db.query('select id from runs')).rows[0].id;
  const r = await handleMessaging(d, { sender: { id: 'intruso' }, recipient: { id: '999' }, postback: { payload: `FC:${id}` } });
  assert.equal(r, 'ignored');
  assert.equal(state.checks, 0);
});

test('texto livre com run aberto (< 7 dias) → checagem; sem run ou run antigo → ignored', async () => {
  const { d, db, state } = await setup({ follows: true });
  const free = (id: string) => ({ sender: { id }, recipient: { id: '999' }, message: { text: 'oi, já segui' } });
  assert.equal(await handleMessaging(d, free('u1')), 'ignored');
  await handleComment(d, comment());
  assert.equal(await handleMessaging(d, free('u1')), 'link_sent');
  assert.equal(state.checks, 1);

  const old = await setup({ follows: true });
  await handleComment(old.d, comment());
  await old.db.query(`update runs set updated_at = now() - interval '8 days'`);
  assert.equal(await handleMessaging(old.d, free('u1')), 'ignored');
  assert.equal(old.state.checks, 0);
  assert.equal((await outbox(db)).length, 3);
});

test('is_echo e mensagens do próprio IG_USER_ID → ignored', async () => {
  const { d, db, state } = await setup();
  await handleComment(d, comment());
  const n = (await outbox(db)).length;
  assert.equal(
    await handleMessaging(d, { sender: { id: 'u1' }, recipient: { id: '999' }, message: { text: 'x', is_echo: true } }),
    'ignored',
  );
  assert.equal(
    await handleMessaging(d, { sender: { id: '999' }, recipient: { id: 'u1' }, message: { text: 'x' } }),
    'ignored',
  );
  assert.equal(state.checks, 0);
  assert.equal((await outbox(db)).length, n);
});

test('handleWebhookBody: mesmo body duas vezes → um só conjunto de itens', async () => {
  const { d, db } = await setup();
  const body = {
    object: 'instagram',
    entry: [{ id: '999', time: 1, changes: [{ field: 'comments', value: comment() }] }],
  };
  await handleWebhookBody(d, body);
  await handleWebhookBody(d, body);
  assert.equal((await outbox(db)).length, 2);
  assert.equal((await db.query('select * from webhook_events')).rows.length, 1);
  assert.ok((await db.query('select processed_at from webhook_events')).rows[0].processed_at);
});

test('handleWebhookBody: nossa resposta pública voltando como comentário é ignorada', async () => {
  const { d, db } = await setup();
  const body = {
    object: 'instagram',
    entry: [{ id: '999', changes: [{ field: 'comments', value: comment({ id: 'r1', from: { id: '999', username: 'minha_conta' }, parent_id: 'c1' }) }] }],
  };
  await handleWebhookBody(d, body);
  assert.equal((await outbox(db)).length, 0);
});

test('handleWebhookBody: mensagens, campo desconhecido e lixo não derrubam; erro fica no evento', async () => {
  const { d, db } = await setup({ auto: { welcome_text: 'x'.repeat(161) } });
  await handleWebhookBody(d, null);
  await handleWebhookBody(d, { entry: 'x' });
  await handleWebhookBody(d, { entry: [{ changes: [{ field: 'mentions', value: {} }], messaging: [{ sender: { id: 'u' } }] }] });
  await handleWebhookBody(d, { entry: [{ changes: [{ field: 'comments', value: comment() }] }] });
  const errs = (await db.query('select error from webhook_events where error is not null')).rows;
  assert.equal(errs.length, 1);
  assert.match(errs[0].error, /160/);
});

const commentBody = (...ids: Array<[string, string]>) => ({
  object: 'instagram',
  entry: [
    {
      id: '999',
      changes: ids.map(([id, media]) => ({ field: 'comments', value: comment({ id, from: { id: `u-${id}` }, media: { id: media } }) })),
    },
  ],
});

async function twoMedias() {
  const s = await setup({ auto: { welcome_text: 'x'.repeat(161) } }); // m1 quebra, m2 funciona
  const ok = await store.saveAutomation(s.db, sampleAutomation({ media_id: 'm2' }));
  await store.setActive(s.db, ok, true);
  return s;
}

test('handleWebhookBody: erro num item não aborta os outros; o item com erro fica pendente com attempts 1', async () => {
  const { d, db } = await twoMedias();
  await handleWebhookBody(d, commentBody(['c1', 'm1'], ['c2', 'm2']));
  const ev = (await db.query('select payload, processed_at, error, attempts from webhook_events order by received_at, id')).rows;
  assert.equal(ev.length, 2);
  const bad = ev.find((e) => e.payload.value.id === 'c1');
  const good = ev.find((e) => e.payload.value.id === 'c2');
  assert.equal(bad.processed_at, null);
  assert.match(bad.error, /160/);
  assert.equal(bad.attempts, 1);
  assert.ok(good.processed_at);
  assert.equal(good.error, null);
  assert.equal(good.attempts, 0);
  assert.deepEqual((await outbox(db)).map((r) => r.payload.commentId), ['c2', 'c2']);
});

test('reprocessPending: só eventos pendentes há > 30 s; sucesso fecha o evento e limpa o erro', async () => {
  const { d, db, aid } = await setup({ auto: { welcome_text: 'x'.repeat(161) } });
  await handleWebhookBody(d, commentBody(['c1', 'm1']));
  assert.equal(await reprocessPending(d), 0, 'recém-recebido: ainda não');
  assert.equal((await outbox(db)).length, 0);

  const later = { ...d, now: () => new Date(Date.now() + 31_000) };
  assert.equal(await reprocessPending(later), 1, 'ainda quebra: conta outra tentativa');
  let ev = (await db.query('select processed_at, error, attempts from webhook_events')).rows[0];
  assert.equal(ev.processed_at, null);
  assert.equal(ev.attempts, 2);

  await db.query(`update automations set welcome_text = 'oi' where id = $1`, [aid]);
  assert.equal(await reprocessPending(later), 1);
  ev = (await db.query('select processed_at, error, attempts from webhook_events')).rows[0];
  assert.ok(ev.processed_at);
  assert.equal(ev.error, null);
  assert.deepEqual((await outbox(db)).map((r) => r.kind), ['comment_reply', 'private_reply']);

  assert.equal(await reprocessPending(later), 0, 'processado não volta');
  assert.equal((await outbox(db)).length, 2);
});

test('reprocessPending: desiste com attempts >= 5; um item com erro não impede os seguintes', async () => {
  const { d, db } = await twoMedias();
  await handleWebhookBody(d, commentBody(['c1', 'm1'], ['c2', 'm2']));
  await db.query(`update webhook_events set processed_at = null, error = null where payload->'value'->>'id' = 'c2'`);
  await db.query(`update webhook_events set attempts = 5 where payload->'value'->>'id' = 'c1'`);
  const later = { ...d, now: () => new Date(Date.now() + 31_000) };
  assert.equal(await reprocessPending(later), 1, 'só o c2');
  const ev = (await db.query('select payload, processed_at, attempts from webhook_events')).rows;
  assert.equal(ev.find((e) => e.payload.value.id === 'c1').attempts, 5);
  assert.ok(ev.find((e) => e.payload.value.id === 'c2').processed_at);

  // dois pendentes: o primeiro quebra, o segundo ainda é processado
  await db.query(`update webhook_events set attempts = 0, processed_at = null`);
  assert.equal(await reprocessPending(later), 2);
  const after = (await db.query('select payload, processed_at, attempts from webhook_events')).rows;
  assert.equal(after.find((e) => e.payload.value.id === 'c1').attempts, 1);
  assert.ok(after.find((e) => e.payload.value.id === 'c2').processed_at);
});
