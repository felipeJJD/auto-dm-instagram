import type { IncomingMessage, ServerResponse } from 'node:http';

export class BodyTooLarge extends Error {}

export function readBody(req: IncomingMessage, limit = 1_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        reject(new BodyTooLarge('corpo grande demais'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
  });
}

export function send(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string | string[]> = {},
): void {
  if (res.headersSent) return;
  const type = headers['Content-Type'] ?? 'text/plain; charset=utf-8';
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
}

export function redirect(
  res: ServerResponse,
  location: string,
  status = 302,
  headers: Record<string, string | string[]> = {},
): void {
  if (res.headersSent) return;
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
