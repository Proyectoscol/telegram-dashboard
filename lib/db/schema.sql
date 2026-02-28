-- Telegram Dashboard Schema (Main Chat)
-- Run on first deploy / startup to create tables if not exist.

CREATE TABLE IF NOT EXISTS chats (
  id BIGINT PRIMARY KEY,
  name TEXT,
  type TEXT,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  from_id TEXT UNIQUE,
  display_name TEXT,
  username TEXT,
  is_premium BOOLEAN DEFAULT FALSE,
  assigned_to TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migrations for existing DBs: add username, allow from_id NULL, unique on username
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'username') THEN
    ALTER TABLE users ADD COLUMN username TEXT;
  END IF;
END $$;
ALTER TABLE users ALTER COLUMN from_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL REFERENCES chats(id),
  message_id BIGINT NOT NULL,
  type TEXT,
  date TIMESTAMPTZ,
  from_id TEXT REFERENCES users(from_id),
  actor_id TEXT REFERENCES users(from_id),
  text TEXT,
  reply_to_message_id BIGINT,
  edited_at TIMESTAMPTZ,
  media_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS reactions (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL REFERENCES chats(id),
  message_id BIGINT NOT NULL,
  reactor_from_id TEXT NOT NULL REFERENCES users(from_id),
  emoji TEXT,
  reacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, message_id, reactor_from_id)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL REFERENCES chats(id),
  filename TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  messages_inserted INT DEFAULT 0,
  messages_skipped INT DEFAULT 0,
  reactions_inserted INT DEFAULT 0,
  reactions_skipped INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contact_calls (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  call_number SMALLINT NOT NULL CHECK (call_number >= 1 AND call_number <= 10),
  called_at TIMESTAMPTZ,
  notes TEXT,
  objections TEXT,
  plans_discussed TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, call_number)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_date ON messages(chat_id, date);
CREATE INDEX IF NOT EXISTS idx_messages_from_id ON messages(from_id);
CREATE INDEX IF NOT EXISTS idx_reactions_chat_message ON reactions(chat_id, message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_reactor ON reactions(reactor_from_id, reacted_at);
CREATE INDEX IF NOT EXISTS idx_contact_calls_user ON contact_calls(user_id);
