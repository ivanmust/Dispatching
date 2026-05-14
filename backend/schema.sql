-- Core users (dispatchers + responders)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('dispatcher', 'responder', 'operator', 'supervisor')),
  callsign TEXT,
  unit TEXT,
  password_hash TEXT
);

-- Ensure existing databases accept the new role set (operator, supervisor)
DO $$
BEGIN
  -- This constraint name matches Postgres default naming for the CHECK on users.role
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'users'
      AND c.conname = 'users_role_check'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;

  ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('dispatcher', 'responder', 'operator', 'supervisor'));
END$$;

-- Ensure password_hash column exists on existing databases
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'password_hash'
  ) THEN
    ALTER TABLE users ADD COLUMN password_hash TEXT;
  END IF;
END$$;

-- User active flag for user management (soft disable)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END$$;

-- Phone for SMS (responders)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'phone'
  ) THEN
    ALTER TABLE users ADD COLUMN phone TEXT;
  END IF;
END$$;

-- Last seen timestamp for basic presence tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'last_seen_at'
  ) THEN
    ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ;
  END IF;
END$$;

-- Incidents
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_status') THEN
    CREATE TYPE incident_status AS ENUM ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_priority') THEN
    CREATE TYPE incident_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status incident_status NOT NULL DEFAULT 'NEW',
  priority incident_priority NOT NULL DEFAULT 'MEDIUM',
  category TEXT NOT NULL,
  location_lat DOUBLE PRECISION NOT NULL,
  location_lon DOUBLE PRECISION NOT NULL,
  location_address TEXT,
  assigned_responder_id UUID REFERENCES users (id),
  assigned_responder_name TEXT,
  created_by_id TEXT,
  created_by_name TEXT,
  created_by_role TEXT CHECK (created_by_role IN ('dispatcher', 'responder', 'operator', 'supervisor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Caller phone for call log / same-number lookup (GINA-style)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'incidents' AND column_name = 'caller_phone') THEN
    ALTER TABLE incidents ADD COLUMN caller_phone TEXT;
  END IF;
END$$;

-- Structured call-taking details (JSON blob of questionnaire answers)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'incidents' AND column_name = 'details') THEN
    ALTER TABLE incidents ADD COLUMN details JSONB;
  END IF;
END$$;

-- Witnesses per incident (GINA: witness contact for follow-up)
CREATE TABLE IF NOT EXISTS incident_witnesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS incident_witnesses_incident_id ON incident_witnesses (incident_id);

-- Incident status history for timeline / audit
CREATE TABLE IF NOT EXISTS incident_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by_id TEXT,
  changed_by_name TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS incident_status_history_incident_id ON incident_status_history (incident_id, created_at DESC);

-- Map drawings, documents, and geofences tables removed in this “MVP” schema variant.

-- Chat messages per incident
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users (id),
  sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('dispatcher', 'responder', 'operator', 'supervisor')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_messages' AND column_name = 'attachment_url') THEN
    ALTER TABLE chat_messages ADD COLUMN attachment_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_messages' AND column_name = 'attachment_type') THEN
    ALTER TABLE chat_messages ADD COLUMN attachment_type TEXT;
  END IF;
END$$;

-- Internal direct messaging: conversations and messages between users
CREATE TABLE IF NOT EXISTS dm_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dm_participants (
  conversation_id UUID NOT NULL REFERENCES dm_conversations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS dm_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES dm_conversations (id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'emergency')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional attachment fields for DM messages
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dm_messages' AND column_name = 'attachment_url') THEN
    ALTER TABLE dm_messages ADD COLUMN attachment_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dm_messages' AND column_name = 'attachment_type') THEN
    ALTER TABLE dm_messages ADD COLUMN attachment_type TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dm_messages' AND column_name = 'attachment_name') THEN
    ALTER TABLE dm_messages ADD COLUMN attachment_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dm_messages' AND column_name = 'attachment_mime_type') THEN
    ALTER TABLE dm_messages ADD COLUMN attachment_mime_type TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dm_messages' AND column_name = 'client_message_id') THEN
    ALTER TABLE dm_messages ADD COLUMN client_message_id TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dm_messages' AND column_name = 'edited_at') THEN
    ALTER TABLE dm_messages ADD COLUMN edited_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dm_messages' AND column_name = 'deleted_at') THEN
    ALTER TABLE dm_messages ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dm_messages' AND column_name = 'forwarded_from_message_id') THEN
    ALTER TABLE dm_messages ADD COLUMN forwarded_from_message_id UUID;
  END IF;
END$$;

-- Legacy OSM road network tables (osm_nodes, osm_road_lines) were removed when
-- routing migrated to the in-country ArcGIS GPServer on esrirw.rw. They are
-- intentionally dropped here so old deployments don't carry stale gigabytes of
-- unused data. Runtime routing no longer touches Postgres for road geometry.
DROP INDEX IF EXISTS osm_road_lines_way_id;
DROP INDEX IF EXISTS osm_road_lines_bbox;
DROP TABLE IF EXISTS osm_road_lines;
DROP TABLE IF EXISTS osm_nodes;

-- Rwanda administrative boundaries (local source for province/district/sector/cell/village resolution)
CREATE TABLE IF NOT EXISTS rwanda_admin_boundaries (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT,
  province TEXT,
  district TEXT,
  sector TEXT,
  cell TEXT,
  village TEXT,
  -- GeoJSON Polygon or MultiPolygon (coordinates in [lon, lat])
  geometry JSONB NOT NULL,
  min_lat DOUBLE PRECISION NOT NULL,
  min_lon DOUBLE PRECISION NOT NULL,
  max_lat DOUBLE PRECISION NOT NULL,
  max_lon DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS rwanda_admin_boundaries_bbox_idx
  ON rwanda_admin_boundaries (min_lat, min_lon, max_lat, max_lon);

-- Idempotency key for retries/offline resend (prevents duplicate messages on retry)
CREATE UNIQUE INDEX IF NOT EXISTS dm_messages_conversation_client_message_id_uid
  ON dm_messages (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

-- Message reactions (one reaction per user per message)
CREATE TABLE IF NOT EXISTS dm_message_reactions (
  message_id UUID NOT NULL REFERENCES dm_messages (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS dm_message_reactions_message_id_idx ON dm_message_reactions (message_id);

CREATE TABLE IF NOT EXISTS dm_message_receipts (
  message_id UUID NOT NULL REFERENCES dm_messages (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS dm_messages_conversation_id_created_at ON dm_messages (conversation_id, created_at);

-- Ensure chat_messages.sender_role and incidents.created_by_role accept supervisor (for existing DBs)
DO $$ BEGIN
  ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_sender_role_check;
  ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_sender_role_check CHECK (sender_role IN ('dispatcher', 'responder', 'operator', 'supervisor'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_created_by_role_check;
  ALTER TABLE incidents ADD CONSTRAINT incidents_created_by_role_check CHECK (created_by_role IN ('dispatcher', 'responder', 'operator', 'supervisor'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow chat_messages.sender_id to be a generic identifier (not strict UUID) in this demo
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chat_messages' AND column_name = 'sender_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_sender_id_fkey;
    ALTER TABLE chat_messages ALTER COLUMN sender_id TYPE TEXT;
  END IF;
END$$;

-- Latest responder location
CREATE TABLE IF NOT EXISTS responder_locations (
  responder_id UUID PRIMARY KEY REFERENCES users (id),
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Allow responder_locations.responder_id to be a generic identifier (not strict UUID) in this demo
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'responder_locations' AND column_name = 'responder_id' AND data_type = 'uuid') THEN
    ALTER TABLE responder_locations DROP CONSTRAINT IF EXISTS responder_locations_responder_id_fkey;
    ALTER TABLE responder_locations ALTER COLUMN responder_id TYPE TEXT;
  END IF;
END$$;

-- Durable responder availability. Socket events update this table so dispatcher
-- reloads can start from the last known availability instead of waiting for the
-- next live socket event.
CREATE TABLE IF NOT EXISTS responder_availability (
  responder_id TEXT PRIMARY KEY,
  available BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit trail for key actions
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_action_created_at ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity ON audit_logs (entity_type, entity_id);

-- Incident recordings table removed in this “MVP” schema variant.

-- User notifications (unread badge + history)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_read_created_at
  ON notifications (user_id, is_read, created_at DESC);

-- Points of interest table removed in this “MVP” schema variant.
