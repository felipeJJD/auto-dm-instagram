import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { createPgDb, migrate } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { saveAutomation } from '../src/store.ts';
import type { AutomationInput } from '../src/store.ts';

const REQUIRED = [
  'name',
  'media_id',
  'welcome_text',
  'welcome_button',
  'ask_follow_text',
  'ask_follow_button',
  'link_text',
  'link_button',
  'link_url',
] as const;

type Item = Record<string, any>;

function toInput(defaults: Item, item: Item): AutomationInput {
  const m = { ...defaults, ...item };
  const missing = REQUIRED.filter((k) => !m[k]);
  if (missing.length) throw new Error(`automação "${m.name ?? item.media_id ?? '?'}": faltam ${missing.join(', ')}`);
  return {
    name: m.name,
    media_id: String(m.media_id),
    media_permalink: m.media_permalink ?? null,
    trigger_mode: m.trigger_mode === 'keywords' ? 'keywords' : 'any',
    keywords: m.keywords ?? [],
    include_replies: m.include_replies ?? true,
    public_replies: m.public_replies ?? [],
    welcome_text: m.welcome_text,
    welcome_button: m.welcome_button,
    ask_follow_text: m.ask_follow_text,
    ask_follow_button: m.ask_follow_button,
    link_text: m.link_text,
    link_button: m.link_button,
    link_url: m.link_url,
  };
}

/** Cria as automações como inativas e pula `media_id` que já existe. Valida tudo antes de gravar. */
export async function importAutomations(
  db: Db,
  json: { defaults?: Item; automations: Item[] },
): Promise<{ created: number; skipped: number }> {
  const inputs = json.automations.map((a) => toInput(json.defaults ?? {}, a));
  const { rows } = await db.query<{ media_id: string }>('select media_id from automations');
  const known = new Set(rows.map((r) => r.media_id));
  let created = 0;
  let skipped = 0;
  for (const input of inputs) {
    if (known.has(input.media_id)) {
      skipped++;
      continue;
    }
    await saveAutomation(db, input);
    known.add(input.media_id);
    created++;
  }
  return { created, skipped };
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) throw new Error('uso: npm run import -- <arquivo.json>');
  const cfg = loadConfig();
  if (!cfg.databaseUrl) throw new Error('DATABASE_URL não definida');
  const db = createPgDb(cfg.databaseUrl);
  try {
    await migrate(db);
    const r = await importAutomations(db, JSON.parse(readFileSync(file, 'utf8')));
    console.log(`importação: ${r.created} criadas, ${r.skipped} puladas (todas inativas; ative no painel)`);
  } finally {
    await db.end();
  }
}
