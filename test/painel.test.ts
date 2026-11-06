import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createTestDb } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import * as store from '../src/store.ts';
import { createApp } from '../src/server.ts';
import { MetaError } from '../src/meta.ts';
import type { MetaClient } from '../src/meta.ts';
import { sampleAutomation } from './helpers.ts';

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

type Res = { status: number; headers: http.IncomingHttpHeaders; text: string };

type StartOpts = {
  env?: Record<string, string>;
  token?: string | null;
  media?: unknown[] | Error;
  account?: { id: string; username: string } | Error;
  fields?: string[] | Error;
};

async function start(o: StartOpts = {}) {
  const subscribes: number[] = [];
  let fields = o.fields ?? [];
  const db = await createTestDb();
  const cfg = loadConfig({ ADMIN_PASSWORD: 'senha-teste', SESSION_SECRET: 'sessao-teste', IG_USER_ID: '999', ...o.env });
  const meta: MetaClient = {
    async replyToComment() {},
    async sendPrivateReply() {},
    async sendMessage() {},
    async getFollowStatus() {
      return { follows: false };
    },
    async listMedia() {
      if (o.media instanceof Error) throw o.media;
      return (o.media ?? []) as any;
    },
    async getAccount() {
      if (o.account instanceof Error) throw o.account;
      return o.account ?? { id: '999', username: 'conta_teste' };
    },
    async getSubscribedFields() {
      if (fields instanceof Error) throw fields;
      return fields;
    },
    async subscribeApp() {
      subscribes.push(Date.now());
      fields = ['comments', 'messages', 'messaging_postbacks'];
    },
  };
  const token = o.token === undefined ? null : o.token;
  const app = createApp({ db, cfg, meta, tokens: { get: async () => token } });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  servers.push(app);
  const port = (app.address() as AddressInfo).port;

  function request(
    method: string,
    path: string,
    opts: { form?: Record<string, string>; cookie?: string; origin?: string | null; host?: string } = {},
  ): Promise<Res> {
    const body = opts.form ? new URLSearchParams(opts.form).toString() : undefined;
    const host = opts.host ?? `127.0.0.1:${port}`;
    const headers: Record<string, string> = { Host: host };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }
    if (opts.cookie) headers.Cookie = opts.cookie;
    if (method === 'POST' && opts.origin !== null) headers.Origin = opts.origin ?? `http://${host}`;
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  async function login(password = 'senha-teste', host?: string) {
    const r = await request('POST', '/painel/login', { form: { senha: password }, host });
    const set = ([] as string[]).concat(r.headers['set-cookie'] ?? [])[0] ?? '';
    return { r, cookie: set.split(';')[0] };
  }

  return { db, cfg, request, login, subscribes };
}

const validForm = (over: Record<string, string> = {}): Record<string, string> => ({
  name: 'Kit Y',
  media_id: 'm9',
  media_permalink: '',
  trigger_mode: 'any',
  keywords: '',
  include_replies: 'on',
  public_replies: 'Ja ta na DM\nVeja suas DMs',
  welcome_text: 'Fala comigo',
  welcome_button: 'Clique aqui',
  ask_follow_text: 'Ja me seguiu ?',
  ask_follow_button: 'Seguindo',
  link_text: 'Pegue abaixo',
  link_button: 'Pegar kit',
  link_url: 'https://example.com/kit',
  ...over,
});

test('sem cookie → 302 para /painel/login (GET e POST), inclusive com cookie adulterado', async () => {
  const { request } = await start();
  for (const p of ['/painel', '/painel/automacoes/nova', '/painel/contatos', '/painel/status', '/painel/posts']) {
    const r = await request('GET', p);
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.location, '/painel/login');
  }
  const post = await request('POST', '/painel/automacoes', { form: validForm() });
  assert.equal(post.status, 302);
  const bad = await request('GET', '/painel', { cookie: 'painel=9999999999999.deadbeef' });
  assert.equal(bad.status, 302);
});

test('login: página, senha errada → 401; 6ª tentativa no minuto → 429', async () => {
  const { request } = await start();
  const page = await request('GET', '/painel/login');
  assert.equal(page.status, 200);
  assert.match(page.text, /<form/);
  for (let i = 0; i < 5; i++) {
    const r = await request('POST', '/painel/login', { form: { senha: 'errada' } });
    assert.equal(r.status, 401, `tentativa ${i + 1}`);
  }
  const sixth = await request('POST', '/painel/login', { form: { senha: 'senha-teste' } });
  assert.equal(sixth.status, 429);
});

test('senha certa → cookie HttpOnly; SameSite=Strict (sem Secure em localhost) e acesso liberado', async () => {
  const { request, login } = await start();
  const { r, cookie } = await login();
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/painel');
  const set = ([] as string[]).concat(r.headers['set-cookie'] ?? []).join('\n');
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  assert.match(set, /Max-Age=604800/);
  assert.doesNotMatch(set, /Secure/);
  const home = await request('GET', '/painel', { cookie });
  assert.equal(home.status, 200);
});

test('fora de localhost o cookie sai com Secure', async () => {
  const { login } = await start();
  const { r } = await login('senha-teste', 'painel.exemplo.com');
  const set = ([] as string[]).concat(r.headers['set-cookie'] ?? []).join('\n');
  assert.match(set, /; Secure/);
});

test('POST com Origin de outro host (ou sem Origin) → 403, mesmo logado e no login', async () => {
  const { request, login } = await start();
  const { cookie } = await login();
  const a = await request('POST', '/painel/automacoes', { form: validForm(), cookie, origin: 'http://evil.example' });
  assert.equal(a.status, 403);
  const b = await request('POST', '/painel/automacoes', { form: validForm(), cookie, origin: null });
  assert.equal(b.status, 403);
  const c = await request('POST', '/painel/login', { form: { senha: 'senha-teste' }, origin: 'http://evil.example' });
  assert.equal(c.status, 403);
});

test('link_url http:// → 400 com mensagem; nada salvo', async () => {
  const { request, login, db } = await start();
  const { cookie } = await login();
  const r = await request('POST', '/painel/automacoes', { form: validForm({ link_url: 'http://example.com/x' }), cookie });
  assert.equal(r.status, 400);
  assert.match(r.text, /https:\/\//);
  assert.equal((await store.listAutomations(db)).length, 0);
});

test('campos obrigatórios e modo palavras sem palavra → 400', async () => {
  const { request, login } = await start();
  const { cookie } = await login();
  assert.equal((await request('POST', '/painel/automacoes', { form: validForm({ name: '  ' }), cookie })).status, 400);
  assert.equal((await request('POST', '/painel/automacoes', { form: validForm({ link_text: '' }), cookie })).status, 400);
  assert.equal((await request('POST', '/painel/automacoes', { form: validForm({ media_id: '' }), cookie })).status, 400);
  const kw = await request('POST', '/painel/automacoes', { form: validForm({ trigger_mode: 'keywords', keywords: ' , ' }), cookie });
  assert.equal(kw.status, 400);
});

test('generic: texto > 160 → 400; com BUTTON_STYLE=button o mesmo texto salva', async () => {
  const long = 'x'.repeat(161);
  const g = await start();
  const { cookie } = await g.login();
  assert.equal((await g.request('POST', '/painel/automacoes', { form: validForm({ welcome_text: long }), cookie })).status, 400);
  assert.equal((await g.request('POST', '/painel/automacoes', { form: validForm({ ask_follow_text: long }), cookie })).status, 400);
  assert.equal((await g.request('POST', '/painel/automacoes', { form: validForm({ link_text: long }), cookie })).status, 400);
  const b = await start({ env: { BUTTON_STYLE: 'button' } });
  const bc = (await b.login()).cookie;
  assert.equal((await b.request('POST', '/painel/automacoes', { form: validForm({ welcome_text: long }), cookie: bc })).status, 303);
});

test('quick_reply: link_text > 160 → 400 (o link vira generic), mas welcome_text longo salva', async () => {
  const long = 'x'.repeat(161);
  const { request, login } = await start({ env: { BUTTON_STYLE: 'quick_reply' } });
  const { cookie } = await login();
  const r = await request('POST', '/painel/automacoes', { form: validForm({ link_text: long }), cookie });
  assert.equal(r.status, 400);
  assert.match(r.text, /Mensagem com o link/);
  assert.equal((await request('POST', '/painel/automacoes', { form: validForm({ welcome_text: long }), cookie })).status, 303);
});

test('cria, lista com números, edita, ativa e desativa', async () => {
  const { request, login, db } = await start();
  const { cookie } = await login();
  const created = await request('POST', '/painel/automacoes', {
    form: validForm({ trigger_mode: 'keywords', keywords: 'kit, pegar', public_replies: 'a\n\n b \n' }),
    cookie,
  });
  assert.equal(created.status, 303);
  const [a] = await store.listAutomations(db);
  assert.equal(created.headers.location, `/painel/automacoes/${a.id}?salvo=1`);
  assert.deepEqual(a.keywords, ['kit', 'pegar']);
  assert.deepEqual(a.public_replies, ['a', 'b']);
  assert.equal(a.active, false);
  assert.equal(a.include_replies, true);

  const run = (await store.createRun(db, { automationId: a.id, igsid: 'u1', commentId: 'c1' }))!;
  await store.setRunState(db, run.id, 'link_sent');
  await store.incrementClick(db, run.id);
  let list = await request('GET', '/painel', { cookie });
  assert.match(list.text, /Kit Y/);
  assert.match(list.text, /100%/);
  assert.match(list.text, /Inativa/);

  const edit = await request('POST', '/painel/automacoes', { form: { ...validForm({ name: 'Renomeada' }), id: String(a.id), include_replies: '' }, cookie });
  assert.equal(edit.status, 303);
  assert.equal((await store.listAutomations(db)).length, 1);
  const b = (await store.getAutomation(db, a.id))!;
  assert.equal(b.name, 'Renomeada');
  assert.equal(b.include_replies, false);

  const form = await request('GET', `/painel/automacoes/${a.id}?salvo=1`, { cookie });
  assert.equal(form.status, 200);
  assert.match(form.text, /Renomeada/);
  assert.match(form.text, /Salvo/);

  assert.equal((await request('POST', `/painel/automacoes/${a.id}/ativar`, { cookie })).status, 303);
  assert.equal((await store.getAutomation(db, a.id))!.active, true);
  list = await request('GET', '/painel', { cookie });
  assert.match(list.text, /Ativa/);
  assert.equal((await request('POST', `/painel/automacoes/${a.id}/desativar`, { cookie })).status, 303);
  assert.equal((await store.getAutomation(db, a.id))!.active, false);
  assert.equal((await request('GET', '/painel/automacoes/9999', { cookie })).status, 404);
  assert.equal((await request('GET', '/painel/automacoes/nova', { cookie })).status, 200);
});

test('ativar com outra automação ativa no mesmo post → recusa', async () => {
  const { request, login, db } = await start();
  const { cookie } = await login();
  const a = await store.saveAutomation(db, sampleAutomation({ media_id: 'dup' }));
  const b = await store.saveAutomation(db, sampleAutomation({ media_id: 'dup', name: 'Outra' }));
  await store.setActive(db, a, true);
  const r = await request('POST', `/painel/automacoes/${b}/ativar`, { cookie });
  assert.equal(r.status, 409);
  assert.equal((await store.getAutomation(db, b))!.active, false);
});

test('nome <script> aparece escapado na lista e no formulário; permalink não-https é recusado e nunca vira href', async () => {
  const { request, login, db } = await start();
  const { cookie } = await login();
  const name = '<script>alert(1)</script>';
  const bad = await request('POST', '/painel/automacoes', { form: validForm({ name, media_permalink: 'javascript:alert(1)' }), cookie });
  assert.equal(bad.status, 400);
  assert.ok(!bad.text.includes('<script>alert(1)'));
  // mesmo que um valor ruim já esteja no banco, a lista não gera href perigoso
  await store.saveAutomation(db, sampleAutomation({ name, media_permalink: 'javascript:alert(1)' }));
  const list = await request('GET', '/painel', { cookie });
  assert.ok(!list.text.includes('<script>alert(1)'));
  assert.match(list.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!/href="javascript:/i.test(list.text));
  const [a] = await store.listAutomations(db);
  const form = await request('GET', `/painel/automacoes/${a.id}`, { cookie });
  assert.ok(!form.text.includes('<script>alert(1)'));
});

test('botão de 33 caracteres salva e mostra aviso', async () => {
  const { request, login, db } = await start();
  const { cookie } = await login();
  const r = await request('POST', '/painel/automacoes', { form: validForm({ welcome_button: 'B'.repeat(33) }), cookie });
  assert.equal(r.status, 303);
  assert.equal((await store.listAutomations(db))[0].welcome_button, 'B'.repeat(33));
  const page = await request('GET', r.headers.location!, { cookie });
  assert.match(page.text, /20 caracteres/);
  assert.match(page.text, /aviso/i);
});

test('contatos: lista os últimos', async () => {
  const { request, login, db } = await start();
  const { cookie } = await login();
  await store.upsertContact(db, 'u1', 'ana<b>');
  const r = await request('GET', '/painel/contatos', { cookie });
  assert.equal(r.status, 200);
  assert.match(r.text, /ana&lt;b&gt;/);
});

test('posts: sem token mostra mensagem amigável; com token lista; erro da Graph não derruba', async () => {
  const none = await start({ token: null });
  const c1 = (await none.login()).cookie;
  const r1 = await none.request('GET', '/painel/posts', { cookie: c1 });
  assert.equal(r1.status, 200);
  assert.match(r1.text, /token/i);

  const ok = await start({
    token: 't',
    media: [{ id: '123', caption: 'Legenda <b>', permalink: 'https://www.instagram.com/reel/abc/', media_product_type: 'REELS', timestamp: '2026-11-01T10:00:00+0000' }],
  });
  const c2 = (await ok.login()).cookie;
  const r2 = await ok.request('GET', '/painel/posts', { cookie: c2 });
  assert.match(r2.text, /123/);
  assert.match(r2.text, /Legenda &lt;b&gt;/);
  assert.match(r2.text, /\/painel\/automacoes\/nova\?media_id=123/);

  const bad = await start({ token: 't', media: new MetaError('Graph HTTP 400 código 190: Invalid', { status: 400, code: 190, retryable: false }) });
  const c3 = (await bad.login()).cookie;
  const r3 = await bad.request('GET', '/painel/posts', { cookie: c3 });
  assert.equal(r3.status, 200);
  assert.match(r3.text, /190/);
});

test('nova automação aceita pré-preenchimento media_id/permalink pela query', async () => {
  const { request, login } = await start();
  const { cookie } = await login();
  const r = await request('GET', '/painel/automacoes/nova?media_id=777&permalink=https%3A%2F%2Fwww.instagram.com%2Freel%2Fx%2F', { cookie });
  assert.match(r.text, /value="777"/);
});

test('status: token, envio, último webhook, fila pendente/falha e último erro (190)', async () => {
  const { request, login, db } = await start({ token: null });
  const { cookie } = await login();
  let r = await request('GET', '/painel/status', { cookie });
  assert.equal(r.status, 200);
  assert.match(r.text, /Token[^<]*<\/th>\s*<td[^>]*>[^<]*não configurado/i);
  assert.match(r.text, /Envio[^<]*<\/th>\s*<td[^>]*>[^<]*desligado/i);
  assert.match(r.text, /nenhum/i);

  await store.recordEvent(db, 'e1', {});
  const id = await store.enqueue(db, 'message', {});
  await store.markFailed(db, id, 'Graph HTTP 400 código 190: Invalid OAuth <x>');
  await store.enqueue(db, 'message', {});
  r = await request('GET', '/painel/status', { cookie });
  assert.match(r.text, /código 190/);
  assert.match(r.text, /&lt;x&gt;/);
  assert.match(r.text, /Pendentes[^<]*<\/th>\s*<td[^>]*>1</);
  assert.match(r.text, /Falhas[^<]*<\/th>\s*<td[^>]*>1</);
});

test('status: mostra quantos eventos do webhook estão com erro', async () => {
  const { request, login, db } = await start({ token: null });
  const { cookie } = await login();
  let r = await request('GET', '/painel/status', { cookie });
  assert.match(r.text, /Eventos com erro[^<]*<\/th>\s*<td[^>]*>0</);

  await store.recordEvent(db, 'e1', {});
  await store.recordEvent(db, 'e2', {});
  await store.recordEvent(db, 'e3', {});
  await store.failEvent(db, 'e1', 'boom');
  await store.failEvent(db, 'e2', 'boom');
  await store.finishEvent(db, 'e3');
  r = await request('GET', '/painel/status', { cookie });
  assert.match(r.text, /Eventos com erro[^<]*<\/th>\s*<td[^>]*>2</);

  await store.finishEvent(db, 'e2');
  r = await request('GET', '/painel/status', { cookie });
  assert.match(r.text, /Eventos com erro[^<]*<\/th>\s*<td[^>]*>1</);
});

test('sair apaga o cookie e volta ao login', async () => {
  const { request, login } = await start();
  const { cookie } = await login();
  const r = await request('POST', '/painel/sair', { cookie });
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/painel/login');
  assert.match(([] as string[]).concat(r.headers['set-cookie'] ?? []).join('\n'), /Max-Age=0/);
});

test('painel sem ADMIN_PASSWORD/SESSION_SECRET → 503 (nunca abre)', async () => {
  const { request } = await start({ env: { ADMIN_PASSWORD: '', SESSION_SECRET: '' } });
  assert.equal((await request('GET', '/painel')).status, 503);
  assert.equal((await request('POST', '/painel/login', { form: { senha: '' } })).status, 503);
});

test('marca: BRAND_NAME e IG_USERNAME aparecem escapados no login e no painel; padrão "Auto DM"', async () => {
  const a = await start({ env: { BRAND_NAME: 'Loja <Ana>', IG_USERNAME: '@loja_ana' } });
  const login = await a.request('GET', '/painel/login');
  assert.match(login.text, /Loja &lt;Ana&gt;/);
  assert.match(login.text, /@loja_ana/);
  const { cookie } = await a.login();
  const list = await a.request('GET', '/painel', { cookie });
  assert.match(list.text, /<title>[^<]*Loja &lt;Ana&gt;<\/title>/);
  assert.doesNotMatch(list.text, /Auto DM/);
  const b = await start();
  assert.match((await b.request('GET', '/painel/login')).text, /Auto DM/);
});

test('configurar: sem nada configurado lista o que falta e não consulta a Graph', async () => {
  const { request, login } = await start({ token: null, env: { IG_USER_ID: '' }, account: new Error('não devia chamar') });
  const { cookie } = await login();
  const r = await request('GET', '/painel/configurar', { cookie });
  assert.equal(r.status, 200);
  for (const v of ['PUBLIC_BASE_URL', 'META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_ACCESS_TOKEN', 'IG_USER_ID', 'SEND_ENABLED']) {
    assert.match(r.text, new RegExp(v));
  }
  assert.doesNotMatch(r.text, /não devia chamar/);
  assert.match(r.text, /data-ok="0"/);
  assert.match(r.text, /docs\/INSTALAR\.md/);
});

test('configurar: tudo pronto mostra a conta, as URLs para a Meta e nunca o app secret', async () => {
  const env = { PUBLIC_BASE_URL: 'https://app.test', META_VERIFY_TOKEN: 'vt-123', META_APP_SECRET: 'segredo-nao-mostrar', SEND_ENABLED: 'true' };
  const { request, login, db } = await start({ token: 'tok', env, fields: ['comments', 'messages', 'messaging_postbacks'] });
  await store.recordEvent(db, 'e1', {});
  const { cookie } = await login();
  const r = await request('GET', '/painel/configurar', { cookie });
  assert.match(r.text, /@conta_teste/);
  assert.match(r.text, /https:\/\/app\.test\/webhook/);
  assert.match(r.text, /https:\/\/app\.test\/privacidade#exclusao/);
  assert.match(r.text, /vt-123/);
  assert.doesNotMatch(r.text, /segredo-nao-mostrar|>tok</);
  assert.doesNotMatch(r.text, /data-ok="0"/);
  assert.doesNotMatch(r.text, /action="\/painel\/configurar\/inscrever"/);
});

test('configurar: webhook sem inscrição mostra o botão; POST inscreve e volta com tudo certo', async () => {
  const { request, login, subscribes } = await start({ token: 'tok', fields: ['comments'] });
  const { cookie } = await login();
  let r = await request('GET', '/painel/configurar', { cookie });
  assert.match(r.text, /messaging_postbacks/);
  assert.match(r.text, /action="\/painel\/configurar\/inscrever"/);
  assert.equal((await request('POST', '/painel/configurar/inscrever', { cookie, origin: 'https://evil.test' })).status, 403);
  assert.equal(subscribes.length, 0);
  r = await request('POST', '/painel/configurar/inscrever', { cookie });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/painel/configurar?inscrito=1');
  assert.equal(subscribes.length, 1);
  r = await request('GET', '/painel/configurar?inscrito=1', { cookie });
  assert.doesNotMatch(r.text, /action="\/painel\/configurar\/inscrever"/);
});

test('configurar: conta do token diferente de IG_USER_ID avisa; erro da Graph aparece escapado', async () => {
  const a = await start({ token: 'tok', account: { id: '123', username: 'outra' } });
  let r = await a.request('GET', '/painel/configurar', { cookie: (await a.login()).cookie });
  assert.match(r.text, /IG_USER_ID/);
  assert.match(r.text, /123/);
  assert.match(r.text, /data-ok="0"/);
  const err = new MetaError('Graph HTTP 400 código 190: Invalid <token>', { status: 400, code: 190, retryable: false });
  const b = await start({ token: 'tok', account: err, fields: err });
  r = await b.request('GET', '/painel/configurar', { cookie: (await b.login()).cookie });
  assert.equal(r.status, 200);
  assert.match(r.text, /código 190: Invalid &lt;token&gt;/);
});

test('lista: aviso de primeira configuração com link para /painel/configurar enquanto falta algo', async () => {
  const a = await start({ token: null });
  const r = await a.request('GET', '/painel', { cookie: (await a.login()).cookie });
  assert.match(r.text, /class="note[^"]*"[^>]*>[^]*?href="\/painel\/configurar"/);
});
