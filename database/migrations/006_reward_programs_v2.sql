-- 006: Multiple reward programs per period, cash / non-cash rewards, award approval workflow.
-- Additive only: no existing program, award, sale or spin row is changed or deleted.

-- Reward programs -----------------------------------------------------------
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS reward_type VARCHAR(16) NOT NULL DEFAULT 'cash';
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'Rs.';
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS description VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS show_on_arena BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS stackable BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS scope_type VARCHAR(16) NOT NULL DEFAULT 'all';
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS scope_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS max_total_awards INT;
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS revision INT NOT NULL DEFAULT 1;
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_reward_programs_v2') THEN
        ALTER TABLE reward_programs ADD CONSTRAINT chk_reward_programs_v2 CHECK (
            kind IN ('daily', 'weekly', 'monthly')
            AND reward_type IN ('cash', 'physical', 'voucher', 'badge', 'time_off', 'custom')
            AND scope_type IN ('all', 'campaign', 'agents')
            AND sales_required >= 1 AND amount >= 0 AND max_awards >= 1
            AND (max_total_awards IS NULL OR max_total_awards >= 1)
        ) NOT VALID; -- enforced for new/changed rows; older rows are left untouched
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_reward_programs_kind ON reward_programs(kind) WHERE archived_at IS NULL;

-- Every create / edit / activate / pause / archive keeps a full snapshot.
CREATE TABLE IF NOT EXISTS reward_program_history (
    id BIGSERIAL PRIMARY KEY,
    program_id VARCHAR(64) NOT NULL REFERENCES reward_programs(id) ON DELETE RESTRICT,
    revision INT NOT NULL,
    action VARCHAR(32) NOT NULL,
    snapshot JSONB NOT NULL,
    admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_program_revision UNIQUE (program_id, revision)
);

-- Bonus awards --------------------------------------------------------------
-- Awards must outlive their program: replace ON DELETE CASCADE with RESTRICT.
DO $$
DECLARE c TEXT;
BEGIN
    SELECT conname INTO c FROM pg_constraint
     WHERE conrelid = 'bonus_awards'::regclass AND contype = 'f' AND confrelid = 'reward_programs'::regclass AND confdeltype = 'c';
    IF c IS NOT NULL THEN
        EXECUTE format('ALTER TABLE bonus_awards DROP CONSTRAINT %I', c);
        ALTER TABLE bonus_awards ADD CONSTRAINT fk_bonus_awards_program FOREIGN KEY (program_id) REFERENCES reward_programs(id) ON DELETE RESTRICT;
    END IF;
END $$;

ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS reward_type VARCHAR(16) NOT NULL DEFAULT 'cash';
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'Rs.';
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS program_revision INT;
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS reward_snapshot JSONB;
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS trigger_case_id VARCHAR(128);
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS announce BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS status_changed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS status_note VARCHAR(500);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bonus_awards_status') THEN
        ALTER TABLE bonus_awards ADD CONSTRAINT chk_bonus_awards_status
            CHECK (status IN ('earned', 'pending_approval', 'approved', 'paid', 'reversed', 'cancelled')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bonus_awards_amount') THEN
        ALTER TABLE bonus_awards ADD CONSTRAINT chk_bonus_awards_amount CHECK (amount >= 0) NOT VALID;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bonus_awards_created ON bonus_awards(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bonus_awards_program_period ON bonus_awards(program_id, period_key);
