import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { processEvents, recordWebhookBody } from '../engine.ts';
import type { WebhookEvent } from '../engine.ts';
import type { AppDeps } from '../server.ts';
import { BodyTooLarge, readBody, send } from './util.ts';

const inflight = new Set<Promise<void>>();

/** Espera o processamento em segundo plano dos webhooks já aceitos (testes e desligamento). */
export async function drainWebhooks(): Promise<void> {
  while (inflight.size > 0) await Promise.allSettled([...inflight]);
}

export function validSignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function handleWebhookVerify(url: URL, res: ServerResponse, d: AppDeps): void {
  const ok =
    d.cfg.verifyToken !== '' &&
    url.searchParams.get('hub.mode') === 'subscribe' &&
    url.searchParams.get('hub.verify_token') === d.cfg.verifyToken;
  if (!ok) return send(res, 403, 'forbidden');
  send(res, 200, url.searchParams.get('hub.challenge') ?? '');
}

export async function handleWebhookPost(req: IncomingMessage, res: ServerResponse, d: AppDeps): Promise<void> {
  let raw: Buffer;
  try {
    raw = await readBody(req);
  } catch (e) {
    if (e instanceof BodyTooLarge) return send(res, 413, 'payload too large', { Connection: 'close' });
    throw e;
  }
  if (!validSignature(raw, req.headers['x-hub-signature-256'] as string | undefined, d.cfg.appSecret)) {
    return send(res, 401, 'invalid signature');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return send(res, 400, 'invalid json');
  }
  // Grava cada item ANTES de responder: se o banco falhar, 500 e a Meta reenvia; com 200 o evento já é nosso.
  let events: WebhookEvent[];
  try {
    events = await recordWebhookBody(d, body);
  } catch (e) {
    console.error('webhook: falha ao gravar evento:', (e as Error).message);
    return send(res, 500, 'erro interno');
  }
  send(res, 200, 'EVENT_RECEIVED');
  if (events.length === 0) return;
  const job: Promise<void> = processEvents(d, events)
    .catch((e) => console.error('webhook:', (e as Error).message))
    .finally(() => inflight.delete(job));
  inflight.add(job);
}
