-- 008: Owner-approved recovery of legitimately earned but missing bonus awards. Additive only.
-- Existing awards are all automatic; nothing is changed or back-filled by this migration.

ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'automatic';
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS recovery_reason VARCHAR(500);
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS recovered_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS recovered_at TIMESTAMPTZ;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bonus_awards_source') THEN
        ALTER TABLE bonus_awards ADD CONSTRAINT chk_bonus_awards_source CHECK (
            source IN ('automatic', 'recovery')
            AND (source <> 'recovery' OR (recovery_reason IS NOT NULL AND recovered_at IS NOT NULL))
        ) NOT VALID;
    END IF;
END $$;

-- Per-agent totals for the current day / week / month (Live Arena leaderboard and podium).
CREATE INDEX IF NOT EXISTS idx_bonus_awards_user_period ON bonus_awards (user_code, kind, period_key);
