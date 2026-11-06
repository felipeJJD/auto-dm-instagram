import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPgDb, createTestDb, migrate } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';

test('migrate é idempotente', async () => {
  const db = await createTestDb();
  await migrate(db);
  const { rows } = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = current_schema()`,
  );
  const names = rows.map((r) => r.table_name);
  for (const t of ['automations', 'contacts', 'runs', 'webhook_events', 'outbox', 'settings']) {
    assert.ok(names.includes(t), `falta tabela ${t}`);
  }
});

test('loadConfig aplica padrões', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.port, 3000);
  assert.equal(cfg.sendEnabled, false);
  assert.equal(cfg.buttonStyle, 'generic');
  assert.equal(cfg.igUserId, '');
  assert.equal(cfg.igUsername, '');
  assert.equal(cfg.brandName, 'Auto DM');
  assert.equal(cfg.graphBase, 'https://graph.facebook.com/v27.0');
  assert.equal(cfg.publicBaseUrl, 'http://localhost:3000');
});

test('loadConfig: IG_USERNAME sem @ e BRAND_NAME', () => {
  const cfg = loadConfig({ IG_USERNAME: '@minha_conta', BRAND_NAME: 'Loja da Ana' });
  assert.equal(cfg.igUsername, 'minha_conta');
  assert.equal(cfg.brandName, 'Loja da Ana');
});

test('loadConfig lê variáveis e rejeita BUTTON_STYLE inválido', () => {
  const cfg = loadConfig({ PORT: '8080', SEND_ENABLED: 'true', BUTTON_STYLE: 'button', PUBLIC_BASE_URL: 'https://x.test/' });
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.sendEnabled, true);
  assert.equal(cfg.buttonStyle, 'button');
  assert.equal(cfg.publicBaseUrl, 'https://x.test');
  assert.throws(() => loadConfig({ BUTTON_STYLE: 'nope' }));
});

test('createPgDb: erro em cliente ocioso do pool é logado e não derruba o processo', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const pool = new pg.Pool({ connectionString: 'postgres://u:p@127.0.0.1:1/x' });
  const db = createPgDb('postgres://u:p@127.0.0.1:1/x', pool);
  assert.doesNotThrow(() => pool.emit('error', new Error('conexão caiu')));
  assert.equal(log.mock.callCount(), 1);
  assert.match(String(log.mock.calls[0].arguments.join(' ')), /conexão caiu/);
  await db.end();
});

test('migrate em banco antigo: aceita undelivered, dá click_token aos runs e attempts aos eventos', async () => {
  const db = await createTestDb();
  await db.query(`insert into automations (name, media_id, welcome_text, welcome_button, ask_follow_text, ask_follow_button,
    link_text, link_button, link_url) values ('a', 'm', 't', 'b', 't', 'b', 't', 'b', 'https://x.test')`);
  await db.query(`insert into runs (automation_id, igsid, comment_id) values (1, 'u1', 'c1')`);
  // estado do banco antigo: CHECK sem 'undelivered', coluna click_token ausente
  await db.query(`alter table runs drop constraint runs_state_check`);
  await db.query(`alter table runs add constraint runs_state_check check (state in ('welcome_sent', 'asked_follow', 'link_sent'))`);
  await db.query(`alter table runs drop column click_token`);
  await db.query(`insert into webhook_events (id, payload) values ('e1', '{}')`);
  await db.query(`alter table webhook_events drop column attempts`);
  await assert.rejects(db.query(`update runs set state = 'undelivered'`));

  await migrate(db);
  await migrate(db);
  await db.query(`update runs set state = 'undelivered'`);
  const { rows } = await db.query<{ state: string; click_token: string }>('select state, click_token from runs');
  assert.equal(rows[0].state, 'undelivered');
  assert.match(rows[0].click_token, /^[0-9a-f]{16}$/);
  await assert.rejects(db.query(`update runs set state = 'outro'`));
  assert.equal((await db.query('select attempts from webhook_events')).rows[0].attempts, 0);
});
