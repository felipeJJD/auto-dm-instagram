import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { graphRequest } from './meta.ts';
import { deleteSetting, getSetting, setSetting } from './store.ts';

const REFRESH_AFTER_MS = 7 * 24 * 3600 * 1000;
const TOKEN_KEY = 'ig_token';
const REFRESHED_KEY = 'ig_token_refreshed_at';
// sha256 do META_ACCESS_TOKEN que originou o token do banco ('' = sem token no env na época).
const ORIGIN_KEY = 'ig_token_env_sha256';

const sha256 = (v: string) => (v ? createHash('sha256').update(v).digest('hex') : '');

function key(secret: string): Buffer {
  if (!secret) throw new Error('META_APP_SECRET ausente: não dá para cifrar o token');
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'meu-manychat/token', 32));
}

export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(secret), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decrypt(blob: string, secret: string): string {
  const buf = Buffer.from(blob, 'base64');
  const d = createDecipheriv('aes-256-gcm', key(secret), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

export function createTokenStore(o: { db: Db; cfg: Config; fetch?: typeof fetch; now?: () => Date }) {
  const f = o.fetch ?? fetch;
  const now = o.now ?? (() => new Date());

  async function save(token: string, envSha: string): Promise<void> {
    await setSetting(o.db, TOKEN_KEY, encrypt(token, o.cfg.appSecret));
    await setSetting(o.db, ORIGIN_KEY, envSha);
  }

  // O token do banco (renovado) vale enquanto o env for o mesmo que o originou; env trocado vence e o substitui.
  async function get(): Promise<string | null> {
    const env = o.cfg.accessToken || null;
    const envSha = sha256(o.cfg.accessToken);
    const raw = await getSetting(o.db, TOKEN_KEY);
    if (!raw) return env;
    const origin = await getSetting(o.db, ORIGIN_KEY);
    if (origin === null) {
      await setSetting(o.db, ORIGIN_KEY, envSha); // banco anterior a este registro: adota o env atual como origem
    } else if (env && origin !== envSha) {
      try {
        await save(env, envSha);
        await deleteSetting(o.db, REFRESHED_KEY);
      } catch (e) {
        console.error('token: não consegui gravar o META_ACCESS_TOKEN novo no banco:', (e as Error).message);
      }
      return env;
    }
    try {
      return decrypt(raw, o.cfg.appSecret);
    } catch {
      console.error('token: não consegui decifrar ig_token do banco; usando META_ACCESS_TOKEN do env');
      return env;
    }
  }

  async function refreshIfDue(): Promise<boolean> {
    // Login unificado (graph.facebook.com) usa token de usuário do sistema: não expira e não aceita ig_refresh_token.
    if (new URL(o.cfg.graphBase).hostname === 'graph.facebook.com') return false;
    const token = await get();
    if (!token) return false;
    const last = await getSetting(o.db, REFRESHED_KEY);
    if (last && now().getTime() - new Date(last).getTime() <= REFRESH_AFTER_MS) return false;
    const host = o.cfg.graphBase.replace(/\/v\d+(\.\d+)?\/?$/, '');
    const res = await graphRequest(f, `${host}/refresh_access_token?grant_type=ig_refresh_token`, token);
    if (!res.access_token) throw new Error('refresh sem access_token na resposta');
    await save(res.access_token, sha256(o.cfg.accessToken));
    await setSetting(o.db, REFRESHED_KEY, now().toISOString());
    return true;
  }

  return { get, refreshIfDue };
}
