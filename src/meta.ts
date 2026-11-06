import type { OutMessage } from './messages.ts';

const RETRY_CODES = new Set([4, 17, 32, 613]);

export class MetaError extends Error {
  status: number;
  code?: number;
  retryable: boolean;
  constructor(message: string, o: { status: number; code?: number; retryable: boolean }) {
    super(message);
    this.name = 'MetaError';
    this.status = o.status;
    this.code = o.code;
    this.retryable = o.retryable;
  }
}

export type MediaItem = {
  id: string;
  caption?: string;
  permalink: string;
  media_product_type: string;
  timestamp: string;
};

export type MetaClient = {
  replyToComment(commentId: string, message: string): Promise<void>;
  sendPrivateReply(commentId: string, message: OutMessage): Promise<void>;
  sendMessage(igsid: string, message: OutMessage): Promise<void>;
  getFollowStatus(igsid: string): Promise<{ follows: boolean; username?: string }>;
  listMedia(): Promise<MediaItem[]>;
  getAccount(): Promise<{ id: string; username: string }>;
  getSubscribedFields(): Promise<string[]>;
  subscribeApp(): Promise<void>;
};

/** Campos do webhook que o serviço usa. */
export const WEBHOOK_FIELDS = ['comments', 'messages', 'messaging_postbacks'];

type Opts = {
  base: string;
  igUserId: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
};

export async function graphRequest(
  f: typeof fetch,
  url: string,
  token: string,
  body?: unknown,
): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await f(url, {
      method: body !== undefined ? 'POST' : 'GET',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new MetaError(`erro de rede: ${(e as Error).message}`, { status: 0, retryable: true });
  }
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const code = typeof json?.error?.code === 'number' ? (json.error.code as number) : undefined;
    const detail = json?.error?.message ? `: ${json.error.message}` : '';
    const retryable = res.status === 429 || res.status >= 500 || (code !== undefined && RETRY_CODES.has(code));
    throw new MetaError(`Graph HTTP ${res.status}${code !== undefined ? ` código ${code}` : ''}${detail}`, {
      status: res.status,
      code,
      retryable,
    });
  }
  return json;
}

export function createMetaClient(o: Opts): MetaClient {
  const f = o.fetch ?? fetch;
  const base = o.base.replace(/\/+$/, '');

  async function call(path: string, body?: unknown): Promise<any> {
    const token = await o.getToken();
    if (!token) throw new MetaError('token ausente', { status: 0, retryable: false });
    return graphRequest(f, `${base}/${path}`, token, body);
  }

  return {
    async replyToComment(commentId, message) {
      await call(`${commentId}/replies`, { message });
    },
    async sendPrivateReply(commentId, message) {
      await call(`${o.igUserId}/messages`, { recipient: { comment_id: commentId }, message });
    },
    async sendMessage(igsid, message) {
      await call(`${o.igUserId}/messages`, { recipient: { id: igsid }, message });
    },
    async getFollowStatus(igsid) {
      const r = await call(`${igsid}?fields=username,is_user_follow_business`);
      if (typeof r.is_user_follow_business !== 'boolean') {
        throw new MetaError('resposta sem is_user_follow_business', { status: 200, retryable: false });
      }
      return { follows: r.is_user_follow_business, username: r.username };
    },
    async listMedia() {
      const r = await call(`${o.igUserId}/media?fields=id,caption,permalink,media_product_type,timestamp&limit=25`);
      return (r.data ?? []) as MediaItem[];
    },
    async getAccount() {
      const r = await call(`${o.igUserId}?fields=id,username`);
      return { id: String(r.id ?? ''), username: String(r.username ?? '') };
    },
    async getSubscribedFields() {
      const r = await call(`${o.igUserId}/subscribed_apps`);
      const apps = (r.data ?? []) as { subscribed_fields?: string[] }[];
      return [...new Set(apps.flatMap((a) => a.subscribed_fields ?? []))];
    },
    async subscribeApp() {
      const r = await call(`${o.igUserId}/subscribed_apps?subscribed_fields=${WEBHOOK_FIELDS.join(',')}`, {});
      if (r.success !== true) throw new MetaError('inscrição sem success na resposta', { status: 200, retryable: false });
    },
  };
}
