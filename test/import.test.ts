import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDb } from '../src/db.ts';
import * as store from '../src/store.ts';
import { importAutomations } from '../scripts/importar.ts';

const json = JSON.parse(readFileSync(new URL('../data/exemplo-automacoes.json', import.meta.url), 'utf8'));

test('importa as 3 automações do exemplo como inativas; de novo pula todas', async () => {
  const db = await createTestDb();
  assert.deepEqual(await importAutomations(db, json), { created: 3, skipped: 0 });
  assert.deepEqual(await importAutomations(db, json), { created: 0, skipped: 3 });
  const all = await store.listAutomations(db);
  assert.equal(all.length, 3);
  assert.ok(all.every((a) => a.active === false));
});

test('item com link_text e palavras-chave próprios; os demais usam o padrão', async () => {
  const db = await createTestDb();
  await importAutomations(db, json);
  const all = await store.listAutomations(db);
  const cupom = all.find((a) => a.name === 'Cupom por palavra-chave')!;
  assert.equal(cupom.link_text, 'Seu cupom está no link abaixo. Vale até domingo!');
  assert.equal(cupom.trigger_mode, 'keywords');
  assert.deepEqual(cupom.keywords, ['cupom', 'desconto']);
  const others = all.filter((a) => a !== cupom);
  assert.ok(others.length > 0);
  assert.ok(others.every((a) => a.link_text === json.defaults.link_text));
  const kit = all.find((a) => a.name === 'Guia de exemplo')!;
  assert.equal(kit.media_id, '17900000000000001');
  assert.equal(kit.link_url, 'https://exemplo.com/guia');
  assert.deepEqual(kit.public_replies, json.defaults.public_replies);
  assert.equal(kit.trigger_mode, 'any');
  assert.equal(kit.welcome_text, json.defaults.welcome_text);
});

test('item sem campo obrigatório → erro claro, nada é criado', async () => {
  const db = await createTestDb();
  await assert.rejects(
    importAutomations(db, { defaults: {}, automations: [{ name: 'Sem nada', media_id: '1' }] }),
    /Sem nada/,
  );
  assert.equal((await store.listAutomations(db)).length, 0);
});
