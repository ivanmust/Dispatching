-- Remove all users and data for a fresh start.
-- Run: psql $DATABASE_URL -f scripts/reset-db.sql
-- Or: node -e "require('./dist/db').pool.query(require('fs').readFileSync('./scripts/reset-db.sql','utf8')).then(()=>process.exit(0))"

TRUNCATE
  dm_message_receipts,
  dm_messages,
  dm_participants,
  dm_conversations,
  chat_messages,
  incident_witnesses,
  responder_locations,
  incidents,
  audit_logs,
  users
RESTART IDENTITY CASCADE;
