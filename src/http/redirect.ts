import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as store from '../store.ts';
import type { AppDeps } from '../server.ts';
import { redirect, send } from './util.ts';

const LINK_RE = /^(\d{1,9})-([0-9a-f]{16})$/;

function sameToken(given: string, expected: string | null): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `linkText` é `<runId>-<click_token>`; id sem token ou token errado dá 404 (impede contar cliques por enumeração). */
export async function handleRedirect(
  req: IncomingMessage,
  res: ServerResponse,
  d: AppDeps,
  linkText: string,
): Promise<void> {
  const m = LINK_RE.exec(linkText);
  if (!m) return send(res, 404, 'não encontrado');
  const id = Number(m[1]);
  const run = await store.getRun(d.db, id);
  const automation = run ? await store.getAutomation(d.db, run.automation_id) : null;
  if (!run || !automation || !sameToken(m[2], run.click_token)) return send(res, 404, 'não encontrado');
  if (req.method === 'GET') await store.incrementClick(d.db, id);
  redirect(res, automation.link_url);
}
