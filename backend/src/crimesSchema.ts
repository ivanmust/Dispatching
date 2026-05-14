import { query } from "./db";

let ensurePromise: Promise<void> | null = null;

async function ensureColumns(): Promise<void> {
  // Primary incident store for this codebase (`incidents` is a legacy mirror).
  await query(`
    CREATE TABLE IF NOT EXISTS crimes (
      crime_id UUID PRIMARY KEY,
      crime_time BIGINT,
      description TEXT,
      status TEXT,
      priority TEXT,
      province TEXT,
      district TEXT,
      sector TEXT,
      cell TEXT,
      village TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      crime_type_l1 TEXT,
      crime_type TEXT,
      created_user TEXT,
      createdat BIGINT,
      updatedat BIGINT,
      action_taken TEXT,
      resolved2 BOOLEAN,
      resolved TEXT,
      title TEXT,
      location_address TEXT,
      details JSONB,
      assigned_responder_id TEXT,
      assigned_responder_name TEXT,
      created_by_id TEXT,
      created_by_name TEXT,
      created_by_role TEXT
    );
  `);

  await query(`
    ALTER TABLE crimes
      ADD COLUMN IF NOT EXISTS title TEXT,
      ADD COLUMN IF NOT EXISTS location_address TEXT,
      ADD COLUMN IF NOT EXISTS details JSONB,
      ADD COLUMN IF NOT EXISTS assigned_responder_id TEXT,
      ADD COLUMN IF NOT EXISTS assigned_responder_name TEXT,
      ADD COLUMN IF NOT EXISTS created_by_id TEXT,
      ADD COLUMN IF NOT EXISTS created_by_name TEXT,
      ADD COLUMN IF NOT EXISTS created_by_role TEXT;
  `);

  // Legacy ArcGIS exports often have NOT NULL objectid; API-driven rows omit it.
  // setval(..., 0) is invalid on PG — empty `crimes` yields MAX NULL; use 1 + is_called=false so nextval() returns 1.
  await query(`
    DO $$
    DECLARE mx bigint;
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'crimes' AND column_name = 'objectid'
      ) THEN
        IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'crimes_objectid_seq') THEN
          CREATE SEQUENCE crimes_objectid_seq;
        END IF;
        SELECT MAX(objectid) INTO mx FROM crimes;
        IF mx IS NULL OR mx < 1 THEN
          PERFORM setval('crimes_objectid_seq', 1, false);
        ELSE
          PERFORM setval('crimes_objectid_seq', mx, true);
        END IF;
        ALTER TABLE crimes
          ALTER COLUMN objectid SET DEFAULT nextval('crimes_objectid_seq');
      END IF;
    EXCEPTION
      WHEN undefined_column THEN NULL;
      WHEN undefined_table THEN NULL;
    END $$;
  `);
}

export async function ensureCrimesOperationalColumns(): Promise<void> {
  if (ensurePromise) {
    await ensurePromise;
    return;
  }
  ensurePromise = ensureColumns().catch((err) => {
    ensurePromise = null;
    throw err;
  });
  await ensurePromise;
}

