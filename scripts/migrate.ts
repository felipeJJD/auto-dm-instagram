import { loadConfig } from '../src/config.ts';
import { createPgDb, migrate } from '../src/db.ts';

const cfg = loadConfig();
if (!cfg.databaseUrl) throw new Error('DATABASE_URL não definida');
const db = createPgDb(cfg.databaseUrl);
try {
  await migrate(db);
  console.log('migração aplicada');
} finally {
  await db.end();
}
