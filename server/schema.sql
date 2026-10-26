CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  data_revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT username_format CHECK (username ~ '^[A-Za-z0-9_-]{3,32}$')
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS folders (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  parent_id uuid,
  name text NOT NULL,
  color text NOT NULL,
  created_at bigint NOT NULL,
  sort_order integer,
  PRIMARY KEY (user_id, id),
  CONSTRAINT folders_parent_fk FOREIGN KEY (user_id, parent_id)
    REFERENCES folders(user_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS folders_parent_idx ON folders(user_id, parent_id);

CREATE TABLE IF NOT EXISTS media (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  data bytea NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS cards (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  folder_id uuid,
  front text NOT NULL,
  back text NOT NULL,
  front_images uuid[] NOT NULL DEFAULT '{}',
  back_images uuid[] NOT NULL DEFAULT '{}',
  schedule jsonb NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (user_id, id),
  CONSTRAINT cards_folder_fk FOREIGN KEY (user_id, folder_id)
    REFERENCES folders(user_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS cards_folder_idx ON cards(user_id, folder_id);
CREATE INDEX IF NOT EXISTS cards_due_idx ON cards(user_id, ((schedule->>'due')));

CREATE TABLE IF NOT EXISTS reviews (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  card_id uuid NOT NULL,
  log jsonb NOT NULL,
  before jsonb NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (user_id, id),
  CONSTRAINT reviews_card_fk FOREIGN KEY (user_id, card_id)
    REFERENCES cards(user_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS reviews_card_idx ON reviews(user_id, card_id, created_at);

-- Durable delta index: deleted records remain as tombstones.
CREATE TABLE IF NOT EXISTS sync_versions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('folders','cards','media','reviews')),
  id uuid NOT NULL,
  version bigint NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX IF NOT EXISTS sync_versions_cursor_idx ON sync_versions(user_id, version);
CREATE TABLE IF NOT EXISTS sync_batches (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
-- Backfill pre-sync collections once, without modifying their content.
DO $$
DECLARE t text; u record;
BEGIN
  FOR u IN SELECT id FROM users LOOP
    IF NOT EXISTS (SELECT 1 FROM sync_versions WHERE user_id = u.id)
       AND (EXISTS (SELECT 1 FROM folders WHERE user_id=u.id) OR EXISTS (SELECT 1 FROM cards WHERE user_id=u.id) OR EXISTS (SELECT 1 FROM media WHERE user_id=u.id) OR EXISTS (SELECT 1 FROM reviews WHERE user_id=u.id)) THEN
      UPDATE users SET data_revision = data_revision + 1 WHERE id = u.id;
      FOREACH t IN ARRAY ARRAY['folders','media','cards','reviews'] LOOP
        EXECUTE format('INSERT INTO sync_versions (user_id, kind, id, version) SELECT r.user_id, %L, r.id, u.data_revision FROM %I r JOIN users u ON u.id=r.user_id WHERE r.user_id=$1 ON CONFLICT DO NOTHING', t, t) USING u.id;
      END LOOP;
    END IF;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION track_sync_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; record_id uuid; next_version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN owner_id := OLD.user_id; record_id := OLD.id;
  ELSE owner_id := NEW.user_id; record_id := NEW.id; END IF;
  UPDATE users SET data_revision = data_revision + 1 WHERE id = owner_id RETURNING data_revision INTO next_version;
  IF next_version IS NOT NULL THEN
    INSERT INTO sync_versions (user_id, kind, id, version, deleted)
      VALUES (owner_id, TG_TABLE_NAME, record_id, next_version, TG_OP = 'DELETE')
      ON CONFLICT (user_id, kind, id) DO UPDATE SET version=EXCLUDED.version, deleted=EXCLUDED.deleted;
  END IF;
  RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['folders','media','cards','reviews'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sync_change ON %I', t);
    EXECUTE format('CREATE TRIGGER sync_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION track_sync_change()', t);
  END LOOP;
END $$;
CREATE TABLE IF NOT EXISTS auth_limits (
  key_hash text PRIMARY KEY,
  window_started timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1
);

ALTER TABLE cards ADD COLUMN IF NOT EXISTS occlusion jsonb;
