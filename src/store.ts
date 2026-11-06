import { randomBytes } from 'node:crypto';
import type { Db } from './db.ts';

export type RunState = 'welcome_sent' | 'asked_follow' | 'link_sent' | 'undelivered';
export type OutboxKind = 'comment_reply' | 'private_reply' | 'message';

export type AutomationInput = {
  name: string;
  media_id: string;
  media_permalink: string | null;
  trigger_mode: 'any' | 'keywords';
  keywords: string[];
  include_replies: boolean;
  public_replies: string[];
  welcome_text: string;
  welcome_button: string;
  ask_follow_text: string;
  ask_follow_button: string;
  link_text: string;
  link_button: string;
  link_url: string;
};

export type Automation = AutomationInput & {
  id: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type Run = {
  id: number;
  automation_id: number;
  igsid: string;
  comment_id: string;
  click_token: string;
  state: RunState;
  link_clicks: number;
  created_at: Date;
  updated_at: Date;
};

export type OutboxItem = {
  id: number;
  kind: OutboxKind;
  payload: any;
  run_id: number | null;
  status: 'pending' | 'sent' | 'failed' | 'dry_run';
  attempts: number;
  next_attempt_at: Date;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
};

const LEASE_MS = 2 * 60 * 1000;

// ---- automações ----

export async function listAutomations(db: Db): Promise<Automation[]> {
  return (await db.query<Automation>('select * from automations order by id desc')).rows;
}

export async function getAutomation(db: Db, id: number): Promise<Automation | null> {
  return (await db.query<Automation>('select * from automations where id = $1', [id])).rows[0] ?? null;
}

export async function findActiveByMedia(db: Db, mediaId: string): Promise<Automation | null> {
  return (
    (await db.query<Automation>('select * from automations where media_id = $1 and active order by id limit 1', [mediaId]))
      .rows[0] ?? null
  );
}

const FIELDS = [
  'name',
  'media_id',
  'media_permalink',
  'trigger_mode',
  'keywords',
  'include_replies',
  'public_replies',
  'welcome_text',
  'welcome_button',
  'ask_follow_text',
  'ask_follow_button',
  'link_text',
  'link_button',
  'link_url',
] as const;

export async function saveAutomation(db: Db, input: AutomationInput & { id?: number }): Promise<number> {
  const values = FIELDS.map((f) => input[f]);
  if (input.id !== undefined) {
    const sets = FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const { rows } = await db.query<{ id: number }>(
      `update automations set ${sets}, updated_at = now() where id = $${FIELDS.length + 1} returning id`,
      [...values, input.id],
    );
    if (!rows[0]) throw new Error(`automação ${input.id} não existe`);
    return rows[0].id;
  }
  const cols = FIELDS.join(', ');
  const ph = FIELDS.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query<{ id: number }>(`insert into automations (${cols}) values (${ph}) returning id`, values);
  return rows[0].id;
}

export async function setActive(db: Db, id: number, active: boolean): Promise<void> {
  await db.query('update automations set active = $2, updated_at = now() where id = $1', [id, active]);
}

// ---- contatos e runs ----

export async function upsertContact(db: Db, igsid: string, username?: string): Promise<void> {
  await db.query(
    `insert into contacts (igsid, username) values ($1, $2)
     on conflict (igsid) do update set last_seen_at = now(), username = coalesce($2, contacts.username)`,
    [igsid, username ?? null],
  );
}

export async function setFollow(db: Db, igsid: string, follows: boolean): Promise<void> {
  await db.query(
    `insert into contacts (igsid, follows, follow_checked_at) values ($1, $2, now())
     on conflict (igsid) do update set follows = $2, follow_checked_at = now(), last_seen_at = now()`,
    [igsid, follows],
  );
}

export async function createRun(
  db: Db,
  o: { automationId: number; igsid: string; commentId: string },
): Promise<Run | null> {
  const { rows } = await db.query<Run>(
    `insert into runs (automation_id, igsid, comment_id, click_token) values ($1, $2, $3, $4)
     on conflict do nothing returning *`,
    [o.automationId, o.igsid, o.commentId, randomBytes(8).toString('hex')],
  );
  return rows[0] ?? null;
}

export async function getRun(db: Db, id: number): Promise<Run | null> {
  return (await db.query<Run>('select * from runs where id = $1', [id])).rows[0] ?? null;
}

export async function setRunState(db: Db, id: number, state: RunState): Promise<void> {
  await db.query('update runs set state = $2, updated_at = now() where id = $1', [id, state]);
}

/** Só sai de welcome_sent: um run que a pessoa já avançou não volta atrás por causa de uma falha tardia. */
export async function markRunUndelivered(db: Db, id: number): Promise<void> {
  await db.query(
    `update runs set state = 'undelivered', updated_at = now() where id = $1 and state = 'welcome_sent'`,
    [id],
  );
}

/** Reaproveita um run undelivered para um novo comentário (volta a welcome_sent). Devolve null se não for o caso. */
export async function reviveRun(db: Db, id: number, commentId: string): Promise<Run | null> {
  const { rows } = await db.query<Run>(
    `update runs set comment_id = $2, state = 'welcome_sent', updated_at = now()
     where id = $1 and state = 'undelivered' and comment_id <> $2 returning *`,
    [id, commentId],
  );
  return rows[0] ?? null;
}

/** Desfaz reviveRun quando o reenvio não pôde ser enfileirado (a Meta reenvia o webhook e tenta de novo). */
export async function restoreUndelivered(db: Db, id: number, previousCommentId: string): Promise<void> {
  await db.query(
    `update runs set comment_id = $2, state = 'undelivered', updated_at = now() where id = $1 and state = 'welcome_sent'`,
    [id, previousCommentId],
  );
}

export async function findRun(db: Db, automationId: number, igsid: string): Promise<Run | null> {
  const { rows } = await db.query<Run>('select * from runs where automation_id = $1 and igsid = $2', [automationId, igsid]);
  return rows[0] ?? null;
}

export async function latestOpenRun(db: Db, igsid: string, since: Date): Promise<Run | null> {
  const { rows } = await db.query<Run>(
    `select * from runs where igsid = $1 and state in ('welcome_sent', 'asked_follow') and updated_at >= $2
     order by updated_at desc, id desc limit 1`,
    [igsid, since],
  );
  return rows[0] ?? null;
}

export async function incrementClick(db: Db, runId: number): Promise<Run | null> {
  const { rows } = await db.query<Run>(
    'update runs set link_clicks = link_clicks + 1, updated_at = now() where id = $1 returning *',
    [runId],
  );
  return rows[0] ?? null;
}

// ---- eventos do webhook ----

export async function recordEvent(db: Db, id: string, payload: unknown): Promise<boolean> {
  const { rows } = await db.query(
    'insert into webhook_events (id, payload) values ($1, $2::jsonb) on conflict do nothing returning id',
    [id, JSON.stringify(payload)],
  );
  return rows.length > 0;
}

export async function finishEvent(db: Db, id: string): Promise<void> {
  await db.query('update webhook_events set processed_at = now(), error = null where id = $1', [id]);
}

/** Processamento falhou: o evento continua pendente (processed_at null) com o erro e mais uma tentativa contada. */
export async function failEvent(db: Db, id: string, error: string): Promise<void> {
  await db.query('update webhook_events set error = $2, attempts = attempts + 1 where id = $1', [id, error]);
}

/** Eventos ainda não processados, recebidos antes de `olderThan` e com menos de `maxAttempts` falhas. */
export async function pendingEvents(
  db: Db,
  olderThan: Date,
  maxAttempts: number,
  limit: number,
): Promise<{ id: string; payload: unknown }[]> {
  const { rows } = await db.query<{ id: string; payload: unknown }>(
    `select id, payload from webhook_events
     where processed_at is null and attempts < $2 and received_at < $1
     order by received_at, id limit $3`,
    [olderThan, maxAttempts, limit],
  );
  return rows;
}

export async function eventErrorCount(db: Db): Promise<number> {
  const { rows } = await db.query<{ n: number }>('select count(*)::int as n from webhook_events where error is not null');
  return rows[0].n;
}

export async function lastEventAt(db: Db): Promise<Date | null> {
  const { rows } = await db.query<{ t: Date | null }>('select max(received_at) as t from webhook_events');
  return rows[0]?.t ?? null;
}

// ---- fila de saída ----

export async function enqueue(db: Db, kind: OutboxKind, payload: unknown, runId?: number): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    'insert into outbox (kind, payload, run_id) values ($1, $2::jsonb, $3) returning id',
    [kind, JSON.stringify(payload), runId ?? null],
  );
  return rows[0].id;
}

/** Pega itens vencidos, conta a tentativa e reserva por 2 min (se o processo morrer, volta sozinho). */
export async function claimDue(db: Db, now: Date, limit: number): Promise<OutboxItem[]> {
  const { rows } = await db.query<OutboxItem>(
    `update outbox set attempts = attempts + 1, next_attempt_at = $3
     where id in (
       select id from outbox where status = 'pending' and next_attempt_at <= $1
       order by next_attempt_at, id limit $2 for update skip locked
     ) returning *`,
    [now, limit, new Date(now.getTime() + LEASE_MS)],
  );
  return rows.sort((a, b) => a.id - b.id);
}

export async function markSent(db: Db, id: number, at: Date = new Date()): Promise<void> {
  await db.query(`update outbox set status = 'sent', sent_at = $2, last_error = null where id = $1`, [id, at]);
}

export async function markRetry(db: Db, id: number, at: Date, err: string): Promise<void> {
  await db.query(`update outbox set status = 'pending', next_attempt_at = $2, last_error = $3 where id = $1`, [
    id,
    at,
    err,
  ]);
}

/** Adia sem gastar tentativa (limite por hora, não falha). */
export async function deferItem(db: Db, id: number, at: Date): Promise<void> {
  await db.query(
    `update outbox set status = 'pending', next_attempt_at = $2, attempts = greatest(attempts - 1, 0) where id = $1`,
    [id, at],
  );
}

export async function markFailed(db: Db, id: number, err: string): Promise<void> {
  await db.query(`update outbox set status = 'failed', last_error = $2 where id = $1`, [id, err]);
}

export async function markDryRun(db: Db, id: number): Promise<void> {
  await db.query(`update outbox set status = 'dry_run' where id = $1`, [id]);
}

export async function countSentSince(db: Db, kind: OutboxKind, since: Date): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from outbox where kind = $1 and status = 'sent' and sent_at >= $2`,
    [kind, since],
  );
  return rows[0].n;
}

/** Instante mais antigo entre os envios de `kind` desde `since` (para saber quando a janela abre). */
export async function oldestSentSince(db: Db, kind: OutboxKind, since: Date): Promise<Date | null> {
  const { rows } = await db.query<{ t: Date | null }>(
    `select min(sent_at) as t from outbox where kind = $1 and status = 'sent' and sent_at >= $2`,
    [kind, since],
  );
  return rows[0]?.t ?? null;
}

export async function outboxSummary(db: Db): Promise<{ pending: number; failed: number }> {
  const { rows } = await db.query<{ pending: number; failed: number }>(
    `select count(*) filter (where status = 'pending')::int as pending,
            count(*) filter (where status = 'failed')::int as failed from outbox`,
  );
  return rows[0];
}

export async function lastFailure(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ last_error: string | null }>(
    `select last_error from outbox where status = 'failed' order by id desc limit 1`,
  );
  return rows[0]?.last_error ?? null;
}

export async function listContacts(db: Db, limit = 200): Promise<ContactRow[]> {
  return (await db.query<ContactRow>('select * from contacts order by last_seen_at desc limit $1', [limit])).rows;
}

// ---- números do painel ----

export type ContactRow = {
  igsid: string;
  username: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  follows: boolean | null;
  follow_checked_at: Date | null;
};

export type Stats = { automation_id: number; runs: number; links: number; clicked_runs: number; clicks: number };

export async function automationStats(db: Db): Promise<Stats[]> {
  const { rows } = await db.query<Stats>(
    `select automation_id,
            count(*)::int as runs,
            count(*) filter (where state = 'link_sent')::int as links,
            count(*) filter (where link_clicks > 0)::int as clicked_runs,
            coalesce(sum(link_clicks), 0)::int as clicks
     from runs group by automation_id order by automation_id`,
  );
  return rows;
}

// ---- ajustes ----

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const { rows } = await db.query<{ value: string }>('select value from settings where key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.query(
    `insert into settings (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, value],
  );
}

export async function deleteSetting(db: Db, key: string): Promise<void> {
  await db.query('delete from settings where key = $1', [key]);
}
