-- Add owner_uid column to meetings table (Firebase UID of the user who created the meeting)
-- Used for auditing/attribution, not for per-user data isolation.
ALTER TABLE meetings ADD COLUMN owner_uid TEXT;
CREATE INDEX IF NOT EXISTS idx_meetings_owner_uid ON meetings(owner_uid);
