import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { MetaError } from './meta.ts';
import type { MetaClient } from './meta.ts';
import * as store from './store.ts';
import type { OutboxItem } from './store.ts';

const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 15 * 60_000;
const HOUR_MS = 3600_000;
const PRIVATE_REPLIES_PER_HOUR = 700;

type Deps = { db: Db; meta: MetaClient; cfg: Config; now?: () => Date };

export function backoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** attempts, MAX_BACKOFF_MS);
}

async function send(meta: MetaClient, item: OutboxItem): Promise<void> {
  const p = item.payload;
  if (item.kind === 'comment_reply') return meta.replyToComment(p.commentId, p.message);
  if (item.kind === 'private_reply') return meta.sendPrivateReply(p.commentId, p.message);
  return meta.sendMessage(p.igsid, p.message);
}

/** A boas-vindas (private_reply) não saiu: o run fica undelivered para um novo comentário poder reenviar. */
async function undeliveredIfWelcome(db: Db, item: OutboxItem): Promise<void> {
  if (item.kind === 'private_reply' && item.run_id !== null) await store.markRunUndelivered(db, item.run_id);
}

/** Processa até `limit` itens vencidos. Devolve quantos foram tratados (enviados, adiados ou falhos). */
export async function processOutbox(d: Deps, limit = 5): Promise<number> {
  const now = d.now ?? (() => new Date());
  const items = await store.claimDue(d.db, now(), limit);
  for (const item of items) {
    const t = now();
    if (!d.cfg.sendEnabled) {
      await store.markDryRun(d.db, item.id);
      await undeliveredIfWelcome(d.db, item);
      continue;
    }
    if (item.kind === 'private_reply') {
      const since = new Date(t.getTime() - HOUR_MS);
      if ((await store.countSentSince(d.db, 'private_reply', since)) >= PRIVATE_REPLIES_PER_HOUR) {
        const oldest = await store.oldestSentSince(d.db, 'private_reply', since);
        const opensAt = new Date((oldest ?? t).getTime() + HOUR_MS + 1000);
        await store.deferItem(d.db, item.id, opensAt);
        continue;
      }
    }
    try {
      await send(d.meta, item);
      await store.markSent(d.db, item.id, t);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof MetaError && e.retryable && item.attempts < MAX_ATTEMPTS) {
        await store.markRetry(d.db, item.id, new Date(t.getTime() + backoffMs(item.attempts)), msg);
      } else {
        await store.markFailed(d.db, item.id, msg);
        await undeliveredIfWelcome(d.db, item);
      }
    }
  }
  return items.length;
}
