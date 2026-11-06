CREATE TABLE IF NOT EXISTS automations (
  id serial PRIMARY KEY,
  name text NOT NULL,
  media_id text NOT NULL,
  media_permalink text,
  trigger_mode text NOT NULL DEFAULT 'any' CHECK (trigger_mode IN ('any', 'keywords')),
  keywords text[] NOT NULL DEFAULT '{}',
  include_replies boolean NOT NULL DEFAULT true,
  public_replies text[] NOT NULL DEFAULT '{}',
  welcome_text text NOT NULL,
  welcome_button text NOT NULL,
  ask_follow_text text NOT NULL,
  ask_follow_button text NOT NULL,
  link_text text NOT NULL,
  link_button text NOT NULL,
  link_url text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  igsid text PRIMARY KEY,
  username text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  follows boolean,
  follow_checked_at timestamptz
);

CREATE TABLE IF NOT EXISTS runs (
  id serial PRIMARY KEY,
  automation_id integer NOT NULL REFERENCES automations(id),
  igsid text NOT NULL,
  comment_id text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'welcome_sent' CHECK (state IN ('welcome_sent', 'asked_follow', 'link_sent', 'undelivered')),
  link_clicks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id, igsid)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

CREATE TABLE IF NOT EXISTS outbox (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('comment_reply', 'private_reply', 'message')),
  payload jsonb NOT NULL,
  run_id integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'dry_run')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS outbox_status_next_idx ON outbox (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Token aleatório do link de clique (/r/<runId>-<token>); runs antigos ganham um na migração.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS click_token text;
UPDATE runs
   SET click_token = substr(replace(gen_random_uuid()::text, '-', ''), 21, 12)
                  || substr(replace(gen_random_uuid()::text, '-', ''), 21, 4)
 WHERE click_token IS NULL;

-- 'undelivered': a private_reply do run terminou failed/dry_run; um novo comentário da pessoa reaproveita o run.
-- Bancos antigos têm o CHECK sem o estado novo: recria (idempotente).
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_state_check;
ALTER TABLE runs ADD CONSTRAINT runs_state_check
  CHECK (state IN ('welcome_sent', 'asked_follow', 'link_sent', 'undelivered'));

-- Tentativas de processamento com erro; reprocessPending desiste ao chegar em 5.
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
