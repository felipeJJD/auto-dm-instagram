import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildButtonMessage, buildText, splitTitle, ValidationError } from '../src/messages.ts';

const exportJson = JSON.parse(readFileSync(new URL('../data/manychat-export.json', import.meta.url), 'utf8'));
const welcome: string = exportJson.defaults.welcome_text;

const postback = { kind: 'postback' as const, title: 'Clique aqui', payload: 'FC:7' };
const link = { kind: 'url' as const, title: 'Pegar kit', url: 'https://example.com/x' };

test('texto curto vira só title', () => {
  assert.deepEqual(splitTitle('Oi!'), { title: 'Oi!' });
});

test('welcome_text do export (> 80) divide em palavra inteira', () => {
  assert.ok(welcome.length > 80 && welcome.length <= 160, `len ${welcome.length}`);
  const { title, subtitle } = splitTitle(welcome);
  assert.ok(title.length <= 80);
  assert.ok(subtitle && subtitle.length > 0);
  assert.equal(`${title} ${subtitle}`, welcome);
  assert.equal(welcome[title.length], ' ');
});

test('161 caracteres em generic → ValidationError', () => {
  const text = 'palavra '.repeat(20) + 'x';
  assert.equal(text.length, 161);
  assert.throws(() => buildButtonMessage(text, postback, 'generic'), ValidationError);
});

test('generic: template com elemento, botão postback', () => {
  const m = buildButtonMessage('Oi!', postback, 'generic');
  assert.deepEqual(m, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [{ title: 'Oi!', buttons: [{ type: 'postback', title: 'Clique aqui', payload: 'FC:7' }] }],
      },
    },
  });
});

test('generic com texto longo preenche subtitle; botão url vira web_url', () => {
  const m = buildButtonMessage(welcome, link, 'generic') as any;
  const el = m.attachment.payload.elements[0];
  assert.ok(el.subtitle);
  assert.deepEqual(el.buttons, [{ type: 'web_url', url: 'https://example.com/x', title: 'Pegar kit' }]);
});

test('button: template_type button com text', () => {
  const m = buildButtonMessage(welcome, postback, 'button') as any;
  assert.equal(m.attachment.payload.template_type, 'button');
  assert.equal(m.attachment.payload.text, welcome);
  assert.equal(m.attachment.payload.buttons[0].payload, 'FC:7');
  assert.throws(() => buildButtonMessage('x'.repeat(641), postback, 'button'), ValidationError);
});

test('quick_reply com postback gera quick_replies[0].payload', () => {
  const m = buildButtonMessage('Já me seguiu?', postback, 'quick_reply') as any;
  assert.equal(m.text, 'Já me seguiu?');
  assert.deepEqual(m.quick_replies[0], { content_type: 'text', title: 'Clique aqui', payload: 'FC:7' });
});

test('quick_reply com botão url cai para generic web_url', () => {
  const m = buildButtonMessage('Pegue aqui', link, 'quick_reply') as any;
  assert.equal(m.attachment.payload.template_type, 'generic');
  assert.equal(m.attachment.payload.elements[0].buttons[0].type, 'web_url');
});

test('buildText', () => {
  assert.deepEqual(buildText('oi'), { text: 'oi' });
});
