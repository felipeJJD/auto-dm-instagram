import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

export type Db = {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

const SCHEMA_PATH = join(import.meta.dirname, '..', 'db', 'schema.sql');

export function createPgDb(url: string, pool = new pg.Pool({ connectionString: url })): Db & { end(): Promise<void> } {
  // Cliente ocioso que perde a conexão emite 'error' no pool; sem ouvinte o Node derruba o processo.
  pool.on('error', (e) => console.error('pg pool:', e.message));
  return {
    async query<T = any>(sql: string, params?: unknown[]) {
      const res = await pool.query(sql, params as any[] | undefined);
      return { rows: res.rows as T[] };
    },
    end: () => pool.end(),
  };
}

// Uma instância PGlite por processo (cada uma custa ~1 s e memória de WASM que o V8 não devolve);
// cada createTestDb() ganha um schema novo. PGlite tem uma conexão só, então as consultas passam
// por uma fila que troca o search_path e executa como uma unidade.
let sharedLite: Promise<PGlite> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let schemaCounter = 0;

export async function createTestDb(): Promise<Db> {
  const lite = await (sharedLite ??= (async () => {
    const l = new PGlite();
    await l.waitReady;
    return l;
  })());
  const schema = `t${++schemaCounter}`;
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };
  await serial(() => lite.exec(`create schema ${schema}`));
  const db: Db = {
    query<T = any>(sql: string, params?: unknown[]) {
      return serial(async () => {
        await lite.exec(`set search_path to ${schema}`);
        if (params === undefined) {
          const results = await lite.exec(sql);
          return { rows: (results[results.length - 1]?.rows ?? []) as T[] };
        }
        const res = await lite.query<T>(sql, params as any[]);
        return { rows: res.rows };
      });
    },
  };
  await migrate(db);
  return db;
}

export async function migrate(db: Db): Promise<void> {
  await db.query(readFileSync(SCHEMA_PATH, 'utf8'));
}
