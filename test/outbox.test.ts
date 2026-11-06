import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import * as store from '../src/store.ts';
import { MetaError } from '../src/meta.ts';
import type { MetaClient } from '../src/meta.ts';
import { backoffMs, processOutbox } from '../src/outbox.ts';
import { sampleAutomation } from './helpers.ts';

function fakeMeta(fail?: () => Error | null) {
  const calls: string[] = [];
  const meta: MetaClient = {
    async replyToComment(c, m) {
      calls.push(`reply ${c} ${m}`);
      const e = fail?.();
      if (e) throw e;
    },
    async sendPrivateReply(c) {
      calls.push(`private ${c}`);
      const e = fail?.();
      if (e) throw e;
    },
    async sendMessage(i) {
      calls.push(`message ${i}`);
      const e = fail?.();
      if (e) throw e;
    },
    async getFollowStatus() {
      return { follows: true };
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
  return { meta, calls };
}

// no futuro: itens enfileirados "agora" já estão vencidos para o relógio falso
const T0 = new Date('2030-01-01T12:00:00Z');

async function setup(env: Record<string, string> = { SEND_ENABLED: 'true' }, fail?: () => Error | null) {
  const db = await createTestDb();
  const clock = { t: T0 };
  const { meta, calls } = fakeMeta(fail);
  const d = { db, meta, cfg: loadConfig(env), now: () => clock.t };
  return { db, d, calls, clock };
}

test('SEND_ENABLED=false → dry_run, Meta não é chamada', async () => {
  const { db, d, calls } = await setup({});
  await store.enqueue(db, 'comment_reply', { commentId: 'c1', message: 'oi' });
  assert.equal(await processOutbox(d), 1);
  assert.equal((await db.query('select status from outbox')).rows[0].status, 'dry_run');
  assert.equal(calls.length, 0);
});

test('envia cada tipo e marca sent com sent_at', async () => {
  const { db, d, calls } = await setup();
  await store.enqueue(db, 'comment_reply', { commentId: 'c1', message: 'oi' });
  await store.enqueue(db, 'private_reply', { commentId: 'c1', message: { text: 'dm' } });
  await store.enqueue(db, 'message', { igsid: 'u1', message: { text: 'dm' } });
  assert.equal(await processOutbox(d), 3);
  assert.deepEqual(calls, ['reply c1 oi', 'private c1', 'message u1']);
  const rows = (await db.query('select status, sent_at from outbox order by id')).rows;
  assert.deepEqual(rows.map((r) => r.status), ['sent', 'sent', 'sent']);
  assert.equal(new Date(rows[0].sent_at).getTime(), T0.getTime());
});

test('respeita limit por chamada', async () => {
  const { db, d } = await setup();
  for (let i = 0; i < 3; i++) await store.enqueue(db, 'message', { igsid: `u${i}`, message: {} });
  assert.equal(await processOutbox(d, 2), 2);
  assert.equal((await store.outboxSummary(db)).pending, 1);
});

test('erro retryable → pending, 10 s na 1ª tentativa; backoff com teto de 15 min', async () => {
  const { db, d, clock } = await setup({ SEND_ENABLED: 'true' }, () => new MetaError('503', { status: 503, retryable: true }));
  const id = await store.enqueue(db, 'message', { igsid: 'u1', message: {} });
  await processOutbox(d);
  let row = (await db.query('select * from outbox where id = $1', [id])).rows[0];
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
  assert.equal(new Date(row.next_attempt_at).getTime(), T0.getTime() + 10_000);
  assert.match(row.last_error, /503/);

  clock.t = new Date(T0.getTime() + 11_000);
  await processOutbox(d);
  row = (await db.query('select * from outbox where id = $1', [id])).rows[0];
  assert.equal(row.attempts, 2);
  assert.equal(new Date(row.next_attempt_at).getTime(), clock.t.getTime() + 20_000);

  // antes do vencimento, nada acontece
  clock.t = new Date(clock.t.getTime() + 1_000);
  assert.equal(await processOutbox(d), 0);

  // chegando à tentativa 7: 5 s × 2^7 = 640 s; tentativa 8 falha de vez; teto confere
  for (let n = 3; n <= 7; n++) {
    clock.t = new Date(new Date(row.next_attempt_at).getTime() + 1);
    await processOutbox(d);
    row = (await db.query('select * from outbox where id = $1', [id])).rows[0];
    assert.equal(row.attempts, n);
    assert.equal(row.status, 'pending');
    const wait = new Date(row.next_attempt_at).getTime() - clock.t.getTime();
    assert.equal(wait, Math.min(5_000 * 2 ** n, 15 * 60_000));
  }
  clock.t = new Date(new Date(row.next_attempt_at).getTime() + 1);
  await processOutbox(d);
  row = (await db.query('select * from outbox where id = $1', [id])).rows[0];
  assert.equal(row.attempts, 8);
  assert.equal(row.status, 'failed');
});

test('teto de 15 min no backoff', async () => {
  const { db, d } = await setup({ SEND_ENABLED: 'true' }, () => new MetaError('x', { status: 500, retryable: true }));
  const id = await store.enqueue(db, 'message', { igsid: 'u1', message: {} });
  await db.query('update outbox set attempts = 7 where id = $1', [id]); // próxima claim = 8ª: vira failed
  await processOutbox(d);
  assert.equal((await db.query('select status from outbox')).rows[0].status, 'failed');
  const id2 = await store.enqueue(db, 'message', { igsid: 'u2', message: {} });
  await db.query('update outbox set attempts = 6 where id = $1', [id2]); // 7ª: 5 × 2^7 = 640 s
  await processOutbox(d);
  const r = (await db.query('select next_attempt_at from outbox where id = $1', [id2])).rows[0];
  assert.equal(new Date(r.next_attempt_at).getTime() - T0.getTime(), 640_000);
  assert.equal(backoffMs(1), 10_000);
  assert.equal(backoffMs(7), 640_000);
  assert.equal(backoffMs(8), 15 * 60_000);
  assert.equal(backoffMs(30), 15 * 60_000);
});

test('MetaError code 190 → failed na hora com 190 no last_error; o resto da fila segue', async () => {
  let n = 0;
  const { db, d, calls } = await setup({ SEND_ENABLED: 'true' }, () =>
    n++ === 0 ? new MetaError('Graph HTTP 400 código 190: Invalid OAuth', { status: 400, code: 190, retryable: false }) : null,
  );
  await store.enqueue(db, 'message', { igsid: 'u1', message: {} });
  await store.enqueue(db, 'message', { igsid: 'u2', message: {} });
  await processOutbox(d);
  const rows = (await db.query('select status, last_error from outbox order by id')).rows;
  assert.equal(rows[0].status, 'failed');
  assert.match(rows[0].last_error, /190/);
  assert.equal(rows[1].status, 'sent');
  assert.equal(calls.length, 2);
});

test('token ausente → failed com mensagem legível', async () => {
  const { db, d } = await setup({ SEND_ENABLED: 'true' }, () => new MetaError('token ausente', { status: 0, retryable: false }));
  await store.enqueue(db, 'comment_reply', { commentId: 'c', message: 'x' });
  await processOutbox(d);
  const r = (await db.query('select status, last_error from outbox')).rows[0];
  assert.equal(r.status, 'failed');
  assert.match(r.last_error, /token ausente/);
  assert.equal((await store.outboxSummary(db)).failed, 1);
});

test('erro inesperado (não MetaError) → failed, sem derrubar o processamento', async () => {
  const { db, d } = await setup({ SEND_ENABLED: 'true' }, () => new TypeError('boom'));
  await store.enqueue(db, 'message', { igsid: 'u1', message: {} });
  assert.equal(await processOutbox(d), 1);
  const r = (await db.query('select status, last_error from outbox')).rows[0];
  assert.equal(r.status, 'failed');
  assert.match(r.last_error, /boom/);
});

test('800 private_reply pendentes → no máximo 700 sent por hora; o resto espera sem perder nem duplicar', async () => {
  const { db, d, calls, clock } = await setup();
  await db.query(
    `insert into outbox (kind, payload) select 'private_reply', jsonb_build_object('commentId', 'c' || g, 'message', '{}'::jsonb) from generate_series(1, 800) g`,
  );
  await processOutbox(d, 1000);
  let sent = (await db.query(`select count(*)::int n from outbox where status = 'sent'`)).rows[0].n;
  assert.equal(sent, 700);
  assert.equal(calls.length, 700);
  const pending = (await db.query(`select attempts, next_attempt_at from outbox where status = 'pending'`)).rows;
  assert.equal(pending.length, 100);
  assert.ok(pending.every((r) => r.attempts === 0), 'adiar por limite não gasta tentativa');
  assert.ok(pending.every((r) => new Date(r.next_attempt_at).getTime() >= T0.getTime() + 3600_000));

  // ainda dentro da janela: nada sai
  clock.t = new Date(T0.getTime() + 30 * 60_000);
  await processOutbox(d, 1000);
  assert.equal(calls.length, 700);

  // janela abre
  clock.t = new Date(T0.getTime() + 3600_000 + 2_000);
  await processOutbox(d, 1000);
  sent = (await db.query(`select count(*)::int n from outbox where status = 'sent'`)).rows[0].n;
  assert.equal(sent, 800);
  assert.equal(calls.length, 800);
  assert.equal(new Set(calls).size, 800, 'nenhum comentário recebeu duas private replies');
});

test('limite de 700/h não bloqueia comment_reply nem message', async () => {
  const { db, d, calls } = await setup();
  await db.query(
    `insert into outbox (kind, payload, status, sent_at) select 'private_reply', '{}'::jsonb, 'sent', $1 from generate_series(1, 700)`,
    [T0],
  );
  await store.enqueue(db, 'private_reply', { commentId: 'cx', message: {} });
  await store.enqueue(db, 'comment_reply', { commentId: 'c1', message: 'oi' });
  await store.enqueue(db, 'message', { igsid: 'u1', message: {} });
  await processOutbox(d, 10);
  assert.deepEqual(calls, ['reply c1 oi', 'message u1']);
});

async function runWithOutbox(db: Awaited<ReturnType<typeof createTestDb>>) {
  const aid = await store.saveAutomation(db, sampleAutomation());
  const run = (await store.createRun(db, { automationId: aid, igsid: 'u1', commentId: 'c1' }))!;
  await store.enqueue(db, 'comment_reply', { commentId: 'c1', message: 'oi' }, run.id);
  await store.enqueue(db, 'private_reply', { commentId: 'c1', message: { text: 'dm' } }, run.id);
  return run;
}

test('private_reply failed → run vira undelivered', async () => {
  const { db, d } = await setup({ SEND_ENABLED: 'true' }, () => new MetaError('Graph HTTP 400 código 100', { status: 400, code: 100, retryable: false }));
  const run = await runWithOutbox(db);
  await processOutbox(d);
  assert.equal((await store.getRun(db, run.id))?.state, 'undelivered');
});

test('falha só do comment_reply não mexe no run', async () => {
  const { db, d } = await setup({ SEND_ENABLED: 'true' }, () => new MetaError('Graph HTTP 400 código 100', { status: 400, code: 100, retryable: false }));
  const aid = await store.saveAutomation(db, sampleAutomation());
  const run = (await store.createRun(db, { automationId: aid, igsid: 'u1', commentId: 'c1' }))!;
  await store.enqueue(db, 'comment_reply', { commentId: 'c1', message: 'oi' }, run.id);
  await processOutbox(d);
  assert.equal((await db.query('select status from outbox')).rows[0].status, 'failed');
  assert.equal((await store.getRun(db, run.id))?.state, 'welcome_sent');
});

test('private_reply dry_run → undelivered; enviada com sucesso → continua welcome_sent', async () => {
  const dry = await setup({});
  const run = await runWithOutbox(dry.db);
  await processOutbox(dry.d);
  assert.equal((await store.getRun(dry.db, run.id))?.state, 'undelivered');

  const ok = await setup({ SEND_ENABLED: 'true' });
  const run2 = await runWithOutbox(ok.db);
  await processOutbox(ok.d);
  assert.equal((await store.getRun(ok.db, run2.id))?.state, 'welcome_sent');
});

test('private_reply com erro retryable ainda pendente não marca o run', async () => {
  const { db, d } = await setup({ SEND_ENABLED: 'true' }, () => new MetaError('HTTP 500', { status: 500, retryable: true }));
  const run = await runWithOutbox(db);
  await processOutbox(d);
  assert.equal((await db.query(`select status from outbox where kind = 'private_reply'`)).rows[0].status, 'pending');
  assert.equal((await store.getRun(db, run.id))?.state, 'welcome_sent');
});
