-- 004_sync_eligibility_devices
-- Sale provenance for reward eligibility, paired Live Arena displays, and safe defaults.
-- Additive only. Existing sales are marked NOT reward-eligible, so no historical
-- sale can ever produce spins or bonuses.

ALTER TABLE validated_sales ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'backfill';
ALTER TABLE validated_sales ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE validated_sales ADD COLUMN IF NOT EXISTS reward_eligible BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE validated_sales ADD COLUMN IF NOT EXISTS closer_name VARCHAR(128);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_validated_sales_source') THEN
        ALTER TABLE validated_sales ADD CONSTRAINT chk_validated_sales_source CHECK (source IN ('backfill', 'sse', 'reconciliation'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_sales_eligible ON validated_sales(user_code, validated_at) WHERE reward_eligible;

-- Current status of a validated sale (Safe Quote can later return/reject it) and its history.
ALTER TABLE validated_sales ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'validated';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_validated_sales_status') THEN
        ALTER TABLE validated_sales ADD CONSTRAINT chk_validated_sales_status CHECK (status IN ('validated', 'returned', 'rejected'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_validated_sales_agent') THEN
        ALTER TABLE validated_sales ADD CONSTRAINT fk_validated_sales_agent FOREIGN KEY (user_code) REFERENCES agents(user_code) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bonus_awards_agent') THEN
        ALTER TABLE bonus_awards ADD CONSTRAINT fk_bonus_awards_agent FOREIGN KEY (user_code) REFERENCES agents(user_code) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS sale_status_history (
    id BIGSERIAL PRIMARY KEY,
    case_id VARCHAR(128) NOT NULL REFERENCES validated_sales(case_id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL CHECK (status IN ('validated', 'returned', 'rejected')),
    source VARCHAR(16) NOT NULL CHECK (source IN ('backfill', 'sse', 'reconciliation')),
    event_id VARCHAR(128),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- The same upstream event never adds a second history row.
    CONSTRAINT uq_sale_status_event UNIQUE (case_id, status, event_id)
);
CREATE INDEX IF NOT EXISTS idx_sale_status_case ON sale_status_history(case_id, recorded_at);

-- Live Arena displays (office TVs) paired by an admin. Only paired displays or a
-- signed-in admin may execute spins. Tokens and pairing codes are stored hashed.
CREATE TABLE IF NOT EXISTS arena_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label VARCHAR(64) NOT NULL,
    token_hash VARCHAR(64) UNIQUE,
    pairing_code_hash VARCHAR(64) UNIQUE,
    pairing_expires_at TIMESTAMPTZ,
    paired_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safe defaults. Automatic rewards stay OFF until an admin sets an activation cutoff.
INSERT INTO admin_settings (key, value) VALUES ('auto_spins_enabled', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value) VALUES ('reward_activation_cutoff', 'null'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value) VALUES ('manual_spin_max_per_grant', '50'::jsonb) ON CONFLICT (key) DO NOTHING;

-- Default global rule (2 validated sales = 1 spin, per business day) if none exists.
INSERT INTO target_rules (id, team_id, sales_per_spin, period, enabled, scope_type, scope_id, spins_per_threshold, effective_from, change_note)
SELECT 'rule_global_v1', NULL, 2, 'daily', TRUE, 'global', NULL, 1, NOW(), 'Initial default rule'
WHERE NOT EXISTS (SELECT 1 FROM target_rules WHERE scope_type = 'global' AND superseded_at IS NULL);
