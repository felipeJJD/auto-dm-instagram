import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db.ts';
import * as store from '../src/store.ts';
import { sampleAutomation } from './helpers.ts';

test('automações: salvar, achar ativa por mídia, ativar/desativar, editar', async () => {
  const db = await createTestDb();
  const id = await store.saveAutomation(db, sampleAutomation());
  assert.equal(await store.findActiveByMedia(db, 'm1'), null);
  await store.setActive(db, id, true);
  const a = await store.findActiveByMedia(db, 'm1');
  assert.equal(a?.id, id);
  assert.deepEqual(a?.public_replies, ['a', 'b']);
  await store.saveAutomation(db, { ...sampleAutomation({ name: 'Novo nome', keywords: ['k'] }), id });
  const b = await store.getAutomation(db, id);
  assert.equal(b?.name, 'Novo nome');
  assert.deepEqual(b?.keywords, ['k']);
  assert.equal(b?.active, true, 'editar não muda o estado ativo');
  assert.equal((await store.listAutomations(db)).length, 1);
  await store.setActive(db, id, false);
  assert.equal(await store.findActiveByMedia(db, 'm1'), null);
});

test('createRun duplicado (mesma automação+igsid) → null; comment_id repetido → null', async () => {
  const db = await createTestDb();
  const aid = await store.saveAutomation(db, sampleAutomation());
  const r1 = await store.createRun(db, { automationId: aid, igsid: 'u1', commentId: 'c1' });
  assert.equal(r1?.state, 'welcome_sent');
  assert.equal(await store.createRun(db, { automationId: aid, igsid: 'u1', commentId: 'c2' }), null);
  assert.equal(await store.createRun(db, { automationId: aid, igsid: 'u2', commentId: 'c1' }), null);
  assert.ok(await store.createRun(db, { automationId: aid, igsid: 'u2', commentId: 'c3' }));
});

test('recordEvent repetido → false; lastEventAt', async () => {
  const db = await createTestDb();
  assert.equal(await store.lastEventAt(db), null);
  assert.equal(await store.recordEvent(db, 'e1', { a: 1 }), true);
  assert.equal(await store.recordEvent(db, 'e1', { a: 1 }), false);
  assert.ok((await store.lastEventAt(db)) instanceof Date);
});

test('failEvent conta a tentativa e deixa o evento pendente; finishEvent fecha e limpa o erro', async () => {
  const db = await createTestDb();
  await store.recordEvent(db, 'e1', { a: 1 });
  await store.failEvent(db, 'e1', 'boom');
  await store.failEvent(db, 'e1', 'boom 2');
  let ev = (await db.query('select processed_at, error, attempts from webhook_events')).rows[0];
  assert.deepEqual({ ...ev }, { processed_at: null, error: 'boom 2', attempts: 2 });
  await store.finishEvent(db, 'e1');
  ev = (await db.query('select processed_at, error, attempts from webhook_events')).rows[0];
  assert.ok(ev.processed_at);
  assert.equal(ev.error, null);
  assert.equal(ev.attempts, 2);
});

test('pendingEvents: sem processed_at, antigos, abaixo do limite de tentativas, mais antigos primeiro; eventErrorCount', async () => {
  const db = await createTestDb();
  for (const id of ['velho', 'novo', 'feito', 'desistiu']) await store.recordEvent(db, id, { id });
  await db.query(`update webhook_events set received_at = now() - interval '2 minutes' where id in ('velho', 'feito', 'desistiu')`);
  await db.query(`update webhook_events set received_at = now() - interval '3 minutes' where id = 'velho'`);
  await store.finishEvent(db, 'feito');
  await db.query(`update webhook_events set attempts = 5 where id = 'desistiu'`);
  const cutoff = new Date(Date.now() - 30_000);
  const rows = await store.pendingEvents(db, cutoff, 5, 10);
  assert.deepEqual(rows.map((r) => r.id), ['velho']);
  assert.deepEqual(rows[0].payload, { id: 'velho' });
  assert.equal((await store.pendingEvents(db, cutoff, 6, 10)).length, 2);
  assert.equal((await store.pendingEvents(db, cutoff, 6, 1)).length, 1);

  assert.equal(await store.eventErrorCount(db), 0);
  await store.failEvent(db, 'novo', 'x');
  await store.failEvent(db, 'desistiu', 'y');
  assert.equal(await store.eventErrorCount(db), 2);
  await store.finishEvent(db, 'novo');
  assert.equal(await store.eventErrorCount(db), 1);
});

test('contatos e estado do run', async () => {
  const db = await createTestDb();
  const aid = await store.saveAutomation(db, sampleAutomation());
  await store.upsertContact(db, 'u1', 'ana');
  await store.upsertContact(db, 'u1');
  await store.setFollow(db, 'u1', true);
  const { rows } = await db.query('select username, follows, follow_checked_at from contacts');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, 'ana', 'upsert sem username não apaga');
  assert.equal(rows[0].follows, true);
  assert.ok(rows[0].follow_checked_at);

  const run = (await store.createRun(db, { automationId: aid, igsid: 'u1', commentId: 'c1' }))!;
  await store.setRunState(db, run.id, 'asked_follow');
  assert.equal((await store.getRun(db, run.id))?.state, 'asked_follow');
  const since = new Date(Date.now() - 7 * 86400_000);
  assert.equal((await store.latestOpenRun(db, 'u1', since))?.id, run.id);
  await store.setRunState(db, run.id, 'link_sent');
  assert.equal(await store.latestOpenRun(db, 'u1', since), null, 'link_sent não é aberto');
  assert.equal(await store.latestOpenRun(db, 'u1', new Date(Date.now() + 1000)), null, 'fora da janela');
});

test('incrementClick soma e devolve o run; inexistente → null', async () => {
  const db = await createTestDb();
  const aid = await store.saveAutomation(db, sampleAutomation());
  const run = (await store.createRun(db, { automationId: aid, igsid: 'u1', commentId: 'c1' }))!;
  assert.equal((await store.incrementClick(db, run.id))?.link_clicks, 1);
  assert.equal((await store.incrementClick(db, run.id))?.link_clicks, 2);
  assert.equal(await store.incrementClick(db, 9999), null);
});

test('claimDue só devolve vencidos, marca attempts+1 e não entrega duas vezes', async () => {
  const db = await createTestDb();
  const now = new Date('2026-11-05T12:00:00Z');
  await store.enqueue(db, 'message', { x: 1 });
  await db.query(`update outbox set next_attempt_at = $1`, [new Date('2026-11-05T11:00:00Z')]);
  await store.enqueue(db, 'message', { x: 2 });
  await db.query(`update outbox set next_attempt_at = $1 where id = 2`, [new Date('2026-11-05T13:00:00Z')]);
  const got = await store.claimDue(db, now, 10);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].payload, { x: 1 });
  assert.equal(got[0].attempts, 1);
});

test('outbox: markRetry/markSent/markFailed/markDryRun, countSentSince, outboxSummary', async () => {
  const db = await createTestDb();
  const a = await store.enqueue(db, 'private_reply', { x: 1 });
  const b = await store.enqueue(db, 'private_reply', { x: 2 });
  const c = await store.enqueue(db, 'comment_reply', { x: 3 });
  const d = await store.enqueue(db, 'message', { x: 4 });
  const at = new Date('2026-11-05T12:00:10Z');
  await store.markRetry(db, a, at, 'tmp');
  let { rows } = await db.query('select status, next_attempt_at, last_error from outbox where id = $1', [a]);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].last_error, 'tmp');
  assert.equal(new Date(rows[0].next_attempt_at).getTime(), at.getTime());
  await store.markSent(db, b);
  await store.markFailed(db, c, 'erro 190');
  await store.markDryRun(db, d);
  assert.equal(await store.countSentSince(db, 'private_reply', new Date(Date.now() - 3600_000)), 1);
  assert.equal(await store.countSentSince(db, 'comment_reply', new Date(Date.now() - 3600_000)), 0);
  assert.deepEqual(await store.outboxSummary(db), { pending: 1, failed: 1 });
  ({ rows } = await db.query('select status from outbox order by id'));
  assert.deepEqual(rows.map((r) => r.status), ['pending', 'sent', 'failed', 'dry_run']);
});

test('automationStats conta runs, links, runs com clique e cliques', async () => {
  const db = await createTestDb();
  const aid = await store.saveAutomation(db, sampleAutomation());
  const r1 = (await store.createRun(db, { automationId: aid, igsid: 'u1', commentId: 'c1' }))!;
  const r2 = (await store.createRun(db, { automationId: aid, igsid: 'u2', commentId: 'c2' }))!;
  await store.createRun(db, { automationId: aid, igsid: 'u3', commentId: 'c3' });
  await store.setRunState(db, r1.id, 'link_sent');
  await store.setRunState(db, r2.id, 'link_sent');
  await store.incrementClick(db, r1.id);
  await store.incrementClick(db, r1.id);
  const stats = await store.automationStats(db);
  assert.deepEqual(stats, [{ automation_id: aid, runs: 3, links: 2, clicked_runs: 1, clicks: 2 }]);
});
