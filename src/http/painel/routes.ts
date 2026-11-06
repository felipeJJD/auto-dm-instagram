import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppDeps } from '../../server.ts';
import * as store from '../../store.ts';
import type { AutomationInput } from '../../store.ts';
import { buildButtonMessage, ValidationError } from '../../messages.ts';
import { BodyTooLarge, readBody, redirect, send } from '../util.ts';
import {
  COOKIE_NAME,
  createLoginLimiter,
  createSession,
  passwordMatches,
  readCookie,
  sameOrigin,
  sessionCookie,
  verifySession,
} from './auth.ts';
import type { LoginLimiter } from './auth.ts';
import {
  contactsPage,
  emptyForm,
  formFromAutomation,
  formPage,
  listPage,
  loginPage,
  messagePage,
  postsPage,
  setupPage,
  setupPending,
  statusPage,
  withBrand,
} from './pages.ts';
import type { FormValues, SetupFacts } from './pages.ts';
import type { Brand } from '../privacidade.ts';

const HTML = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
const limiters = new WeakMap<object, LoginLimiter>();
const brands = new WeakMap<ServerResponse, Brand>();

function html(res: ServerResponse, status: number, body: string, headers: Record<string, string | string[]> = {}): void {
  send(res, status, withBrand(body, brands.get(res) ?? { brandName: 'Auto DM', igUsername: '' }), { ...HTML, ...headers });
}

/** Junta o que a página Configurar mostra; só consulta a Graph quando há token e IG_USER_ID. */
async function setupFacts(d: AppDeps, extra: Partial<SetupFacts> = {}): Promise<SetupFacts> {
  const token = await d.tokens.get().catch(() => null);
  const live = !!token && !!d.cfg.igUserId;
  const safe = <T,>(p: Promise<T>) => p.catch((e) => ({ error: (e as Error).message }));
  const [lastWebhook, account, fields] = await Promise.all([
    store.lastEventAt(d.db),
    live ? safe(d.meta.getAccount()) : null,
    live ? safe(d.meta.getSubscribedFields()) : null,
  ]);
  return {
    publicBaseUrl: d.cfg.publicBaseUrl,
    appSecret: !!d.cfg.appSecret,
    verifyToken: d.cfg.verifyToken,
    token: !!token,
    igUserId: d.cfg.igUserId,
    account,
    fields,
    lastWebhook,
    sendEnabled: d.cfg.sendEnabled,
    ...extra,
  };
}

function clientIp(req: IncomingMessage): string {
  // Atrás do proxy da Railway, a última entrada de X-Forwarded-For é a que o proxy anexou.
  const xff = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return xff.at(-1) ?? req.socket.remoteAddress ?? 'desconhecido';
}

function formFromParams(p: URLSearchParams): FormValues {
  const g = (k: string) => (p.get(k) ?? '').trim();
  return {
    id: g('id') || undefined,
    name: g('name'),
    media_id: g('media_id'),
    media_permalink: g('media_permalink'),
    trigger_mode: g('trigger_mode') === 'keywords' ? 'keywords' : 'any',
    keywords: g('keywords'),
    include_replies: p.get('include_replies') === 'on',
    public_replies: (p.get('public_replies') ?? '').replace(/\r/g, ''),
    welcome_text: g('welcome_text'),
    welcome_button: g('welcome_button'),
    ask_follow_text: g('ask_follow_text'),
    ask_follow_button: g('ask_follow_button'),
    link_text: g('link_text'),
    link_button: g('link_button'),
    link_url: g('link_url'),
  };
}

function splitList(s: string, sep: RegExp): string[] {
  return s
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
}

function validate(v: FormValues, d: AppDeps): { errors: string[]; input?: AutomationInput } {
  const errors: string[] = [];
  const required: [string, string][] = [
    ['Nome', v.name],
    ['ID do post', v.media_id],
    ['Primeira mensagem', v.welcome_text],
    ['Botão da primeira mensagem', v.welcome_button],
    ['Mensagem de pedir para seguir', v.ask_follow_text],
    ['Botão de pedir para seguir', v.ask_follow_button],
    ['Mensagem com o link', v.link_text],
    ['Botão do link', v.link_button],
  ];
  for (const [label, value] of required) if (!value) errors.push(`${label} é obrigatório.`);

  let urlOk = /^https:\/\//i.test(v.link_url);
  if (urlOk) {
    try {
      new URL(v.link_url);
    } catch {
      urlOk = false;
    }
  }
  if (!urlOk) errors.push('O link de destino precisa começar com https:// e ser um endereço válido.');
  if (v.media_permalink && !/^https:\/\//i.test(v.media_permalink)) {
    errors.push('O link do post precisa começar com https:// (ou ficar em branco).');
  }

  const keywords = splitList(v.keywords, /[,\n]/);
  if (v.trigger_mode === 'keywords' && keywords.length === 0) {
    errors.push('No modo palavra-chave, informe ao menos uma palavra.');
  }

  // A DM do link leva botão de URL: em quick_reply ela vira generic (≤ 160), então valida com o botão real.
  const dummy = { kind: 'postback', title: 'x', payload: 'FC:0' } as const;
  const dummyLink = { kind: 'url', title: 'x', url: 'https://x.test' } as const;
  for (const [label, text, button] of [
    ['Primeira mensagem', v.welcome_text, dummy],
    ['Mensagem de pedir para seguir', v.ask_follow_text, dummy],
    ['Mensagem com o link', v.link_text, dummyLink],
  ] as const) {
    try {
      buildButtonMessage(text, button, d.cfg.buttonStyle);
    } catch (e) {
      if (e instanceof ValidationError) errors.push(`${label}: ${e.message}.`);
      else throw e;
    }
  }
  if (errors.length) return { errors };

  return {
    errors,
    input: {
      name: v.name,
      media_id: v.media_id,
      media_permalink: v.media_permalink || null,
      trigger_mode: v.trigger_mode === 'keywords' ? 'keywords' : 'any',
      keywords,
      include_replies: v.include_replies,
      public_replies: splitList(v.public_replies, /\n/),
      welcome_text: v.welcome_text,
      welcome_button: v.welcome_button,
      ask_follow_text: v.ask_follow_text,
      ask_follow_button: v.ask_follow_button,
      link_text: v.link_text,
      link_button: v.link_button,
      link_url: v.link_url,
    },
  };
}

async function readForm(req: IncomingMessage, res: ServerResponse): Promise<URLSearchParams | null> {
  try {
    return new URLSearchParams((await readBody(req, 200_000)).toString('utf8'));
  } catch (e) {
    if (e instanceof BodyTooLarge) {
      html(res, 413, messagePage('Erro', 'Formulário grande demais.'), { Connection: 'close' });
      return null;
    }
    throw e;
  }
}

/** Trata `/painel*`; devolve true se respondeu. */
export async function handlePainel(req: IncomingMessage, res: ServerResponse, d: AppDeps): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');
  brands.set(res, d.cfg);

  if (!d.cfg.adminPassword || !d.cfg.sessionSecret) {
    html(res, 503, messagePage('Painel desligado', 'Defina ADMIN_PASSWORD e SESSION_SECRET para usar o painel.'));
    return true;
  }
  if (method !== 'GET' && method !== 'POST') {
    send(res, 405, 'method not allowed');
    return true;
  }
  if (method === 'POST' && !sameOrigin(req)) {
    html(res, 403, messagePage('Bloqueado', 'Origem da requisição não confere com o painel.'));
    return true;
  }

  if (path === '/painel/login') {
    if (method === 'GET') {
      html(res, 200, loginPage());
      return true;
    }
    let limiter = limiters.get(d);
    if (!limiter) limiters.set(d, (limiter = createLoginLimiter()));
    if (!limiter.hit(clientIp(req))) {
      html(res, 429, loginPage('Muitas tentativas. Espere um minuto.'), { 'Retry-After': '60' });
      return true;
    }
    const form = await readForm(req, res);
    if (!form) return true;
    if (!passwordMatches(form.get('senha') ?? '', d.cfg.adminPassword)) {
      html(res, 401, loginPage('Senha incorreta.'));
      return true;
    }
    redirect(res, '/painel', 302, { 'Set-Cookie': sessionCookie(createSession(d.cfg.sessionSecret), req.headers.host) });
    return true;
  }

  if (path === '/painel/sair' && method === 'POST') {
    redirect(res, '/painel/login', 302, { 'Set-Cookie': sessionCookie('', req.headers.host, 0) });
    return true;
  }

  if (!verifySession(readCookie(req, COOKIE_NAME), d.cfg.sessionSecret)) {
    redirect(res, '/painel/login');
    return true;
  }

  if (path === '/painel' && method === 'GET') {
    const [automations, stats, lastWebhook, summary, token] = await Promise.all([
      store.listAutomations(d.db),
      store.automationStats(d.db),
      store.lastEventAt(d.db),
      store.outboxSummary(d.db),
      d.tokens.get().catch(() => null),
    ]);
    const pending = setupPending({
      publicBaseUrl: d.cfg.publicBaseUrl,
      appSecret: !!d.cfg.appSecret,
      verifyToken: d.cfg.verifyToken,
      token: !!token,
      igUserId: d.cfg.igUserId,
      lastWebhook,
    });
    html(res, 200, listPage(automations, stats, { sendEnabled: d.cfg.sendEnabled, lastWebhook, failed: summary.failed, setupPending: pending }));
    return true;
  }

  if (path === '/painel/automacoes/nova' && method === 'GET') {
    const v = emptyForm();
    v.media_id = url.searchParams.get('media_id') ?? '';
    const permalink = url.searchParams.get('permalink') ?? '';
    v.media_permalink = /^https:\/\//i.test(permalink) ? permalink : '';
    html(res, 200, formPage(v));
    return true;
  }

  if (path === '/painel/automacoes' && method === 'POST') {
    const form = await readForm(req, res);
    if (!form) return true;
    const v = formFromParams(form);
    const { errors, input } = validate(v, d);
    if (!input) {
      html(res, 400, formPage(v, { errors }));
      return true;
    }
    let id: number;
    if (v.id) {
      if (!/^\d+$/.test(v.id) || !(await store.getAutomation(d.db, Number(v.id)))) {
        html(res, 404, messagePage('Não encontrada', 'Essa automação não existe.'));
        return true;
      }
      id = await store.saveAutomation(d.db, { ...input, id: Number(v.id) });
    } else {
      id = await store.saveAutomation(d.db, input);
    }
    redirect(res, `/painel/automacoes/${id}?salvo=1`, 303);
    return true;
  }

  const one = /^\/painel\/automacoes\/(\d+)$/.exec(path);
  if (one && method === 'GET') {
    const a = await store.getAutomation(d.db, Number(one[1]));
    if (!a) {
      html(res, 404, messagePage('Não encontrada', 'Essa automação não existe.'));
    } else {
      html(res, 200, formPage(formFromAutomation(a), { saved: url.searchParams.get('salvo') === '1' }));
    }
    return true;
  }

  const toggle = /^\/painel\/automacoes\/(\d+)\/(ativar|desativar)$/.exec(path);
  if (toggle && method === 'POST') {
    const id = Number(toggle[1]);
    const a = await store.getAutomation(d.db, id);
    if (!a) {
      html(res, 404, messagePage('Não encontrada', 'Essa automação não existe.'));
      return true;
    }
    if (toggle[2] === 'ativar') {
      const other = await store.findActiveByMedia(d.db, a.media_id);
      if (other && other.id !== id) {
        html(res, 409, messagePage('Conflito', `A automação "${other.name}" já está ativa nesse post. Desative-a antes.`));
        return true;
      }
    }
    await store.setActive(d.db, id, toggle[2] === 'ativar');
    redirect(res, '/painel', 303);
    return true;
  }

  if (path === '/painel/contatos' && method === 'GET') {
    html(res, 200, contactsPage(await store.listContacts(d.db, 200)));
    return true;
  }

  if (path === '/painel/posts' && method === 'GET') {
    const token = await d.tokens.get().catch(() => null);
    if (!token) {
      html(res, 200, postsPage({ message: 'Token do Instagram não configurado: defina META_ACCESS_TOKEN para listar os posts. Você ainda pode digitar o ID do post à mão.' }));
      return true;
    }
    try {
      const [posts, automations] = await Promise.all([d.meta.listMedia(), store.listAutomations(d.db)]);
      html(res, 200, postsPage({ posts, automations }));
    } catch (e) {
      html(res, 200, postsPage({ message: `Erro ao consultar a Graph API: ${(e as Error).message}` }));
    }
    return true;
  }

  if (path === '/painel/status' && method === 'GET') {
    const token = await d.tokens.get().catch(() => null);
    const [summary, lastWebhook, lastError, eventErrors] = await Promise.all([
      store.outboxSummary(d.db),
      store.lastEventAt(d.db),
      store.lastFailure(d.db),
      store.eventErrorCount(d.db),
    ]);
    html(
      res,
      200,
      statusPage({ tokenConfigured: !!token, sendEnabled: d.cfg.sendEnabled, lastWebhook, ...summary, eventErrors, lastError }),
    );
    return true;
  }

  if (path === '/painel/configurar' && method === 'GET') {
    html(res, 200, setupPage(await setupFacts(d, { subscribed: url.searchParams.get('inscrito') === '1' })));
    return true;
  }

  if (path === '/painel/configurar/inscrever' && method === 'POST') {
    try {
      await d.meta.subscribeApp();
    } catch (e) {
      html(res, 502, setupPage(await setupFacts(d, { subscribeError: (e as Error).message })));
      return true;
    }
    redirect(res, '/painel/configurar?inscrito=1', 303);
    return true;
  }

  return false;
}
