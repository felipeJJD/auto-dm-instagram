import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesTrigger, normalize } from '../src/match.ts';

test('normalize tira acentos, caixa e espaços repetidos', () => {
  assert.equal(normalize('  PegÁR   o  KIT '), 'pegar o kit');
});

test('modo any casa texto vazio e só emoji', () => {
  const a = { trigger_mode: 'any' as const, keywords: [] };
  assert.equal(matchesTrigger(a, ''), true);
  assert.equal(matchesTrigger(a, '🔥'), true);
});

test('modo keywords casa palavra inteira sem diferenciar caixa e acento', () => {
  const a = { trigger_mode: 'keywords' as const, keywords: ['Pegar', 'kit'] };
  assert.equal(matchesTrigger(a, 'quero o KIT'), true);
  assert.equal(matchesTrigger(a, 'pegár'), true);
  assert.equal(matchesTrigger(a, 'kit!!! 🔥'), true);
  assert.equal(matchesTrigger(a, 'kitado'), false);
  assert.equal(matchesTrigger(a, ''), false);
  assert.equal(matchesTrigger(a, '🔥🔥'), false);
});

test('keywords com lista vazia ou palavra vazia nunca casa', () => {
  assert.equal(matchesTrigger({ trigger_mode: 'keywords', keywords: [] }, 'qualquer coisa'), false);
  assert.equal(matchesTrigger({ trigger_mode: 'keywords', keywords: ['', '  '] }, 'qualquer coisa'), false);
});

test('keyword com várias palavras e acento na palavra-chave', () => {
  const a = { trigger_mode: 'keywords' as const, keywords: ['Código EDT'] };
  assert.equal(matchesTrigger(a, 'quero o codigo edt, por favor'), true);
  assert.equal(matchesTrigger(a, 'codigo'), false);
});
