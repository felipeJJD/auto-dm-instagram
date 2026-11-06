import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetaClient, MetaError } from '../src/meta.ts';

type Call = { url: string; method: string; headers: Record<string, string>; body: any };

function fakeFetch(responses: Array<{ status?: number; body?: unknown } | Error>) {
  const calls: Call[] = [];
  const f = (async (url: any, init: any = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const r = responses.shift() ?? { status: 200, body: {} };
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function client(responses: Array<{ status?: number; body?: unknown } | Error>, token: string | null = 'x') {
  const { f, calls } = fakeFetch(responses);
  const meta = createMetaClient({
    base: 'https://graph.example/v27.0',
    igUserId: '111',
    getToken: async () => token,
    fetch: f,
  });
  return { meta, calls };
}

test('replyToComment: POST /{comment}/replies {message}', async () => {
  const { meta, calls } = client([{ body: { id: 'r1' } }]);
  await meta.replyToComment('c1', 'oi');
  assert.equal(calls[0].url, 'https://graph.example/v27.0/c1/replies');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { message: 'oi' });
  assert.equal(calls[0].headers['Authorization'], 'Bearer x');
});

test('sendPrivateReply: recipient.comment_id', async () => {
  const { meta, calls } = client([{}]);
  await meta.sendPrivateReply('c1', { text: 'dm' });
  assert.equal(calls[0].url, 'https://graph.example/v27.0/111/messages');
  assert.deepEqual(calls[0].body, { recipient: { comment_id: 'c1' }, message: { text: 'dm' } });
});

test('sendMessage: recipient.id', async () => {
  const { meta, calls } = client([{}]);
  await meta.sendMessage('ig9', { text: 'dm' });
  assert.equal(calls[0].url, 'https://graph.example/v27.0/111/messages');
  assert.deepEqual(calls[0].body, { recipient: { id: 'ig9' }, message: { text: 'dm' } });
});

test('getFollowStatus: GET com fields', async () => {
  const { meta, calls } = client([{ body: { username: 'ana', is_user_follow_business: true } }]);
  const r = await meta.getFollowStatus('ig9');
  assert.equal(calls[0].url, 'https://graph.example/v27.0/ig9?fields=username,is_user_follow_business');
  assert.equal(calls[0].method, 'GET');
  assert.deepEqual(r, { follows: true, username: 'ana' });
});

test('getFollowStatus: campo ausente → erro (não assume false)', async () => {
  const { meta } = client([{ body: { username: 'ana' } }]);
  await assert.rejects(meta.getFollowStatus('ig9'), MetaError);
});

test('listMedia: URL e retorno de data', async () => {
  const items = [{ id: '1', permalink: 'p', media_product_type: 'REELS', timestamp: 't' }];
  const { meta, calls } = client([{ body: { data: items } }]);
  const r = await meta.listMedia();
  assert.equal(
    calls[0].url,
    'https://graph.example/v27.0/111/media?fields=id,caption,permalink,media_product_type,timestamp&limit=25',
  );
  assert.deepEqual(r, items);
});

test('code 613 → retryable', async () => {
  const { meta } = client([{ status: 400, body: { error: { code: 613, message: 'calls' } } }]);
  await assert.rejects(meta.replyToComment('c', 'x'), (e: any) => e instanceof MetaError && e.retryable && e.code === 613);
});

test('code 190 → não retryable e mensagem legível', async () => {
  const { meta } = client([{ status: 400, body: { error: { code: 190, message: 'Invalid OAuth' } } }]);
  await assert.rejects(
    meta.replyToComment('c', 'x'),
    (e: any) => e instanceof MetaError && !e.retryable && e.code === 190 && /190/.test(e.message),
  );
});

test('HTTP 503, 429 → retryable; 400 sem código → não', async () => {
  const { meta } = client([{ status: 503 }, { status: 429 }, { status: 400, body: {} }]);
  await assert.rejects(meta.replyToComment('c', 'x'), (e: any) => e.retryable === true && e.status === 503);
  await assert.rejects(meta.replyToComment('c', 'x'), (e: any) => e.retryable === true);
  await assert.rejects(meta.replyToComment('c', 'x'), (e: any) => e.retryable === false);
});

test('erro de rede → retryable', async () => {
  const { meta } = client([new TypeError('fetch failed')]);
  await assert.rejects(meta.replyToComment('c', 'x'), (e: any) => e instanceof MetaError && e.retryable);
});

test('getAccount: GET /{ig}?fields=id,username devolve a conta do token', async () => {
  const { meta, calls } = client([{ body: { id: '111', username: 'minha_conta' } }]);
  assert.deepEqual(await meta.getAccount(), { id: '111', username: 'minha_conta' });
  assert.equal(calls[0].url, 'https://graph.example/v27.0/111?fields=id,username');
  assert.equal(calls[0].method, 'GET');
});

test('getSubscribedFields: junta os campos de subscribed_apps; vazio → []', async () => {
  const { meta, calls } = client([
    { body: { data: [{ app_id: '9', subscribed_fields: ['comments', 'messages'] }] } },
    { body: { data: [] } },
  ]);
  assert.deepEqual(await meta.getSubscribedFields(), ['comments', 'messages']);
  assert.deepEqual(await meta.getSubscribedFields(), []);
  assert.equal(calls[0].url, 'https://graph.example/v27.0/111/subscribed_apps');
});

test('subscribeApp: POST /{ig}/subscribed_apps com os três campos do webhook', async () => {
  const { meta, calls } = client([{ body: { success: true } }]);
  await meta.subscribeApp();
  assert.equal(calls[0].method, 'POST');
  assert.equal(
    calls[0].url,
    'https://graph.example/v27.0/111/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks',
  );
});

test('subscribeApp: resposta sem success → MetaError', async () => {
  const { meta } = client([{ body: { success: false } }]);
  await assert.rejects(meta.subscribeApp(), (e: any) => e instanceof MetaError);
});

test('sem token → MetaError não retryable "token ausente", sem chamar a rede', async () => {
  const { meta, calls } = client([], null);
  await assert.rejects(
    meta.replyToComment('c', 'x'),
    (e: any) => e instanceof MetaError && !e.retryable && /token ausente/.test(e.message),
  );
  assert.equal(calls.length, 0);
});
