import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const COOKIE_NAME = 'painel';
export const SESSION_SECONDS = 7 * 24 * 3600;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 5;

function mac(secret: string, exp: string): string {
  return createHmac('sha256', secret).update(`painel:${exp}`).digest('hex');
}

export function createSession(secret: string, now: Date = new Date()): string {
  const exp = String(now.getTime() + SESSION_SECONDS * 1000);
  return `${exp}.${mac(secret, exp)}`;
}

export function verifySession(value: string | undefined, secret: string, now: Date = new Date()): boolean {
  if (!value || !secret) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  const expected = Buffer.from(mac(secret, exp));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  return Number(exp) > now.getTime();
}

export function passwordMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return expected !== '' && timingSafeEqual(a, b);
}

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export function isLocalHost(host: string | undefined): boolean {
  const h = (host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

export function sessionCookie(value: string, host: string | undefined, maxAge = SESSION_SECONDS): string {
  const secure = isLocalHost(host) ? '' : '; Secure';
  return `${COOKIE_NAME}=${value}; Path=/painel; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}

/** POST só passa se o Origin existir e apontar para o mesmo host da requisição. */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export type LoginLimiter = { hit(key: string, now?: number): boolean };

/** Janela móvel por IP: devolve false quando passa de 5 tentativas em 60 s. */
export function createLoginLimiter(): LoginLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
      if (recent.length >= LOGIN_MAX_ATTEMPTS) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= LOGIN_WINDOW_MS)) hits.delete(k);
      return true;
    },
  };
}
