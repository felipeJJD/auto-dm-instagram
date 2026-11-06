import { loadConfig } from '../src/config.ts';
import { createPgDb, migrate } from '../src/db.ts';
import { createMetaClient } from '../src/meta.ts';
import { createTokenStore } from '../src/token.ts';
import { reprocessPending } from '../src/engine.ts';
import { startLoop } from '../src/loop.ts';
import { processOutbox } from '../src/outbox.ts';
import { createApp } from '../src/server.ts';
import { drainWebhooks } from '../src/http/webhook.ts';

const cfg = loadConfig();
if (!cfg.databaseUrl) throw new Error('DATABASE_URL não definida');

const db = createPgDb(cfg.databaseUrl);
await migrate(db);

const tokens = createTokenStore({ db, cfg });
const meta = createMetaClient({ base: cfg.graphBase, igUserId: cfg.igUserId, getToken: () => tokens.get() });
const server = createApp({ db, cfg, meta, tokens });

if (!cfg.appSecret || !cfg.verifyToken) console.warn('aviso: META_APP_SECRET/META_VERIFY_TOKEN ausentes; /webhook recusa tudo');
if (!cfg.adminPassword || !cfg.sessionSecret) console.warn('aviso: ADMIN_PASSWORD/SESSION_SECRET ausentes; /painel desligado');
if (!cfg.sendEnabled) console.warn('aviso: SEND_ENABLED != true; a saída fica em dry_run');

await new Promise<void>((resolve) => server.listen(cfg.port, resolve));
console.log(`meu-manychat ouvindo na porta ${cfg.port}`);

const outboxLoop = startLoop(() => processOutbox({ db, meta, cfg }), 1000, 'outbox');
// Eventos do webhook que ficaram sem processar (erro ou queda do processo) voltam por aqui.
const sweepLoop = startLoop(() => reprocessPending({ db, meta, cfg }), 60_000, 'varredura de eventos');

const refresh = () =>
  tokens
    .refreshIfDue()
    .then((did) => did && console.log('token renovado'))
    .catch((e) => console.error('renovação do token:', (e as Error).message));
void refresh();
const refreshTimer = setInterval(refresh, 24 * 3600 * 1000);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`${signal}: encerrando`);
  clearInterval(refreshTimer);
  // Espera o ciclo em andamento do outbox/varredura antes de fechar servidor e pool.
  await Promise.all([outboxLoop.stop(), sweepLoop.stop()]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await drainWebhooks();
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
