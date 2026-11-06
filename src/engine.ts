import { createHash } from 'node:crypto';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { MetaClient } from './meta.ts';
import { matchesTrigger } from './match.ts';
import { buildButtonMessage } from './messages.ts';
import * as store from './store.ts';

export type EngineDeps = {
  db: Db;
  meta: Pick<MetaClient, 'getFollowStatus'>;
  cfg: Config;
  random?: () => number;
  now?: () => Date;
};

export type CommentValue = {
  id: string;
  text?: string;
  from: { id: string; username?: string };
  media: { id: string };
  parent_id?: string;
};

export type MessagingItem = {
  sender: { id: string };
  recipient: { id: string };
  message?: { text?: string; is_echo?: boolean; quick_reply?: { payload: string } };
  postback?: { payload: string };
};

const OPEN_RUN_WINDOW_MS = 7 * 24 * 3600 * 1000;
const PAYLOAD_RE = /^FC:(\d+)$/;

export async function handleComment(d: EngineDeps, v: CommentValue): Promise<'ignored' | 'skipped' | 'started'> {
  if (!v?.id || !v.from?.id || !v.media?.id) return 'ignored';
  if (v.from.id === d.cfg.igUserId) return 'ignored';
  const a = await store.findActiveByMedia(d.db, v.media.id);
  if (!a) return 'ignored';
  if (v.parent_id && !a.include_replies) return 'ignored';
  if (!matchesTrigger(a, v.text ?? '')) return 'ignored';

  // Monta a DM antes de criar o run: texto inválido não deixa run órfão.
  const buildWelcome = (runId: number) =>
    buildButtonMessage(a.welcome_text, { kind: 'postback', title: a.welcome_button, payload: `FC:${runId}` }, d.cfg.buttonStyle);
  buildWelcome(0);

  await store.upsertContact(d.db, v.from.id, v.from.username);
  let run = await store.createRun(d.db, { automationId: a.id, igsid: v.from.id, commentId: v.id });
  // Run undelivered (a boas-vindas nunca saiu): o novo comentário reaproveita o run e reenvia.
  let previousCommentId: string | null = null;
  if (!run) {
    const prev = await store.findRun(d.db, a.id, v.from.id);
    if (prev?.state === 'undelivered') {
      run = await store.reviveRun(d.db, prev.id, v.id);
      previousCommentId = prev.comment_id;
    }
    if (!run) return 'skipped';
  }

  const queued: number[] = [];
  try {
    if (a.public_replies.length > 0) {
      const rnd = (d.random ?? Math.random)();
      const i = Math.min(a.public_replies.length - 1, Math.floor(rnd * a.public_replies.length));
      queued.push(await store.enqueue(d.db, 'comment_reply', { commentId: v.id, message: a.public_replies[i] }, run.id));
    }
    queued.push(await store.enqueue(d.db, 'private_reply', { commentId: v.id, message: buildWelcome(run.id) }, run.id));
  } catch (e) {
    // Sem transação: se a fila falhar, desfaz o que esta tentativa criou para a Meta poder reenviar.
    if (queued.length > 0) await d.db.query('delete from outbox where id = any($1::int[])', [queued]).catch(() => {});
    if (previousCommentId === null) await d.db.query('delete from runs where id = $1', [run.id]).catch(() => {});
    else await store.restoreUndelivered(d.db, run.id, previousCommentId).catch(() => {});
    throw e;
  }
  return 'started';
}

export async function handleFollowCheck(
  d: EngineDeps,
  runId: number,
): Promise<'link_sent' | 'asked_follow' | 'ignored'> {
  const run = await store.getRun(d.db, runId);
  if (!run) return 'ignored';
  const a = await store.getAutomation(d.db, run.automation_id);
  if (!a) return 'ignored';

  const sendLink = async () => {
    const url = `${d.cfg.publicBaseUrl}/r/${run.id}-${run.click_token}`;
    const message = buildButtonMessage(a.link_text, { kind: 'url', title: a.link_button, url }, d.cfg.buttonStyle);
    await store.enqueue(d.db, 'message', { igsid: run.igsid, message }, run.id);
    if (run.state !== 'link_sent') await store.setRunState(d.db, run.id, 'link_sent');
    return 'link_sent' as const;
  };

  if (run.state === 'link_sent') return sendLink();

  let follows = false;
  try {
    follows = (await d.meta.getFollowStatus(run.igsid)).follows;
    await store.setFollow(d.db, run.igsid, follows);
  } catch {
    follows = false;
  }
  if (follows) return sendLink();

  const message = buildButtonMessage(
    a.ask_follow_text,
    { kind: 'postback', title: a.ask_follow_button, payload: `FC:${run.id}` },
    d.cfg.buttonStyle,
  );
  await store.enqueue(d.db, 'message', { igsid: run.igsid, message }, run.id);
  await store.setRunState(d.db, run.id, 'asked_follow');
  return 'asked_follow';
}

export async function handleMessaging(d: EngineDeps, item: MessagingItem): Promise<string> {
  const senderId = item?.sender?.id;
  if (!senderId || senderId === d.cfg.igUserId) return 'ignored';
  if (item.message?.is_echo) return 'ignored';

  const payload = item.postback?.payload ?? item.message?.quick_reply?.payload;
  if (payload !== undefined) {
    const m = PAYLOAD_RE.exec(payload);
    if (!m) return 'ignored';
    const run = await store.getRun(d.db, Number(m[1]));
    if (!run || run.igsid !== senderId) return 'ignored';
    return handleFollowCheck(d, run.id);
  }

  if (item.message?.text) {
    const now = (d.now ?? (() => new Date()))();
    const run = await store.latestOpenRun(d.db, senderId, new Date(now.getTime() - OPEN_RUN_WINDOW_MS));
    if (!run) return 'ignored';
    return handleFollowCheck(d, run.id);
  }
  return 'ignored';
}

function eventId(item: unknown): string {
  return createHash('sha256').update(JSON.stringify(item)).digest('hex');
}

export type WebhookEvent = { id: string; payload: unknown };

/** Itens processáveis do corpo: mudanças de comentário e mensagens. O payload guardado é o próprio item. */
function webhookItems(body: unknown): unknown[] {
  const entries = (body as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return [];
  const items: unknown[] = [];
  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field === 'comments' && change.value) items.push(change);
    }
    for (const item of Array.isArray(entry?.messaging) ? entry.messaging : []) items.push(item);
  }
  return items;
}

/**
 * Grava cada item novo do corpo (dedup por hash) e devolve os que ainda precisam ser processados.
 * Falha de banco propaga: o webhook responde 500 e a Meta reenvia. Itens já gravados voltam em
 * `reprocessPending` se ficarem sem processar.
 */
export async function recordWebhookBody(d: EngineDeps, body: unknown): Promise<WebhookEvent[]> {
  const fresh: WebhookEvent[] = [];
  for (const payload of webhookItems(body)) {
    const id = eventId(payload);
    if (await store.recordEvent(d.db, id, payload)) fresh.push({ id, payload });
  }
  return fresh;
}

async function dispatchEvent(d: EngineDeps, payload: any): Promise<unknown> {
  if (payload?.field === 'comments') return handleComment(d, payload.value);
  return handleMessaging(d, payload);
}

/** Processa cada evento isolado dos demais: erro num deles fica registrado nele (pendente, com tentativa contada). */
export async function processEvents(d: EngineDeps, events: WebhookEvent[]): Promise<void> {
  for (const e of events) {
    try {
      await dispatchEvent(d, e.payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await store.failEvent(d.db, e.id, msg).catch((x) => console.error('evento:', (x as Error).message));
      continue;
    }
    await store.finishEvent(d.db, e.id).catch((x) => console.error('evento:', (x as Error).message));
  }
}

export async function handleWebhookBody(d: EngineDeps, body: unknown): Promise<void> {
  await processEvents(d, await recordWebhookBody(d, body));
}

const REPROCESS_AFTER_MS = 30_000;
const MAX_EVENT_ATTEMPTS = 5;
const REPROCESS_BATCH = 50;

/** Varredura: reprocessa eventos sem processed_at há mais de 30 s e com menos de 5 falhas. Devolve quantos tentou. */
export async function reprocessPending(d: EngineDeps): Promise<number> {
  const now = (d.now ?? (() => new Date()))();
  const events = await store.pendingEvents(
    d.db,
    new Date(now.getTime() - REPROCESS_AFTER_MS),
    MAX_EVENT_ATTEMPTS,
    REPROCESS_BATCH,
  );
  await processEvents(d, events);
  return events.length;
}
