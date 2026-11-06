-- 003_spin_credit_ledger
-- Auditable spin credit ledger (automatic + manual grants, consumption), versioned
-- spin rules, per-agent eligibility and spin idempotency. Additive only.

-- Balance row per agent: the locked row every ledger write goes through.
ALTER TABLE spin_credits ADD COLUMN IF NOT EXISTS auto_earned INT NOT NULL DEFAULT 0;
ALTER TABLE spin_credits ADD COLUMN IF NOT EXISTS manual_earned INT NOT NULL DEFAULT 0;
ALTER TABLE spin_credits ADD COLUMN IF NOT EXISTS consumed INT NOT NULL DEFAULT 0;
ALTER TABLE spin_credits ADD COLUMN IF NOT EXISTS last_spin_at TIMESTAMPTZ;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_spin_credits_available_nonneg') THEN
        ALTER TABLE spin_credits ADD CONSTRAINT chk_spin_credits_available_nonneg CHECK (available >= 0);
    END IF;
END $$;

-- Append-only ledger. Every change to a balance is one row with before/after values.
CREATE TABLE IF NOT EXISTS spin_credit_transactions (
    id BIGSERIAL PRIMARY KEY,
    user_code VARCHAR(64) NOT NULL,
    agent_id VARCHAR(64),
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('automatic', 'manual', 'consume')),
    quantity INT NOT NULL,
    balance_before INT NOT NULL CHECK (balance_before >= 0),
    balance_after INT NOT NULL CHECK (balance_after >= 0),
    admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    reason TEXT,
    rule_id VARCHAR(64),
    period_key VARCHAR(32),
    threshold_n INT,
    sale_id VARCHAR(64),
    spin_result_id VARCHAR(64),
    -- Unique per logical operation: replays and duplicate deliveries cannot grant twice.
    idempotency_key VARCHAR(160) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_sct_balance_math CHECK (balance_after = balance_before + quantity),
    CONSTRAINT chk_sct_sign CHECK ((kind = 'consume' AND quantity < 0) OR (kind <> 'consume' AND quantity > 0)),
    CONSTRAINT chk_sct_manual_reason CHECK (kind <> 'manual' OR (reason IS NOT NULL AND length(btrim(reason)) >= 3)),
    CONSTRAINT chk_sct_manual_admin CHECK (kind <> 'manual' OR admin_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_sct_user ON spin_credit_transactions(user_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sct_created ON spin_credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sct_rule_period ON spin_credit_transactions(rule_id, user_code, period_key);

-- Spin results: one row per authorised spin, deduplicated by the caller's request key.
ALTER TABLE spin_results ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160);
ALTER TABLE spin_results ADD COLUMN IF NOT EXISTS actor VARCHAR(160);
ALTER TABLE spin_results ADD COLUMN IF NOT EXISTS reward_snapshot JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS uq_spin_results_idempotency ON spin_results(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Typed detail tables for the two ways spins are granted. Each points at exactly one
-- ledger row; their unique keys make duplicate grants impossible at the database level.
CREATE TABLE IF NOT EXISTS manual_spin_allocations (
    id BIGSERIAL PRIMARY KEY,
    transaction_id BIGINT NOT NULL UNIQUE REFERENCES spin_credit_transactions(id) ON DELETE RESTRICT,
    user_code VARCHAR(64) NOT NULL,
    admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
    quantity INT NOT NULL CHECK (quantity > 0),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manual_alloc_user ON manual_spin_allocations(user_code, created_at DESC);

CREATE TABLE IF NOT EXISTS automatic_spin_awards (
    id BIGSERIAL PRIMARY KEY,
    transaction_id BIGINT NOT NULL UNIQUE REFERENCES spin_credit_transactions(id) ON DELETE RESTRICT,
    user_code VARCHAR(64) NOT NULL,
    rule_id VARCHAR(64) NOT NULL REFERENCES target_rules(id) ON DELETE RESTRICT,
    period_key VARCHAR(32) NOT NULL,
    threshold_n INT NOT NULL CHECK (threshold_n >= 1),
    sales_counted INT NOT NULL CHECK (sales_counted >= 1),
    trigger_sale_id VARCHAR(64) REFERENCES validated_sales(id) ON DELETE RESTRICT,
    quantity INT NOT NULL CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One award per rule version, agent, period and threshold.
    CONSTRAINT uq_auto_award UNIQUE (rule_id, user_code, period_key, threshold_n)
);

-- Spin rules become versioned: a change inserts a new row and supersedes the old one,
-- so history is kept and past grants keep pointing at the rule that created them.
ALTER TABLE target_rules ADD COLUMN IF NOT EXISTS scope_type VARCHAR(16) NOT NULL DEFAULT 'global';
ALTER TABLE target_rules ADD COLUMN IF NOT EXISTS scope_id VARCHAR(64);
ALTER TABLE target_rules ADD COLUMN IF NOT EXISTS spins_per_threshold INT NOT NULL DEFAULT 1;
ALTER TABLE target_rules ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE target_rules ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
ALTER TABLE target_rules ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE target_rules ADD COLUMN IF NOT EXISTS change_note TEXT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_target_rules_scope') THEN
        ALTER TABLE target_rules ADD CONSTRAINT chk_target_rules_scope CHECK (scope_type IN ('global', 'team', 'campaign'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_target_rules_values') THEN
        ALTER TABLE target_rules ADD CONSTRAINT chk_target_rules_values CHECK (sales_per_spin >= 1 AND spins_per_threshold >= 1);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_target_rules_period') THEN
        ALTER TABLE target_rules ADD CONSTRAINT chk_target_rules_period CHECK (period IN ('daily', 'weekly', 'monthly', 'lifetime'));
    END IF;
END $$;
-- At most one current version per scope.
CREATE UNIQUE INDEX IF NOT EXISTS uq_target_rules_current ON target_rules(scope_type, COALESCE(scope_id, '')) WHERE superseded_at IS NULL;

-- Per-agent eligibility for automatic spins (manual grants are still possible).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS spin_eligible BOOLEAN NOT NULL DEFAULT TRUE;

-- Referential integrity to agents and related records (all tables are new or empty here).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_spin_credits_agent') THEN
        ALTER TABLE spin_credits ADD CONSTRAINT fk_spin_credits_agent FOREIGN KEY (user_code) REFERENCES agents(user_code) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sct_agent') THEN
        ALTER TABLE spin_credit_transactions ADD CONSTRAINT fk_sct_agent FOREIGN KEY (user_code) REFERENCES agents(user_code) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sct_sale') THEN
        ALTER TABLE spin_credit_transactions ADD CONSTRAINT fk_sct_sale FOREIGN KEY (sale_id) REFERENCES validated_sales(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sct_rule') THEN
        ALTER TABLE spin_credit_transactions ADD CONSTRAINT fk_sct_rule FOREIGN KEY (rule_id) REFERENCES target_rules(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sct_spin_result') THEN
        ALTER TABLE spin_credit_transactions ADD CONSTRAINT fk_sct_spin_result FOREIGN KEY (spin_result_id) REFERENCES spin_results(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_manual_alloc_agent') THEN
        ALTER TABLE manual_spin_allocations ADD CONSTRAINT fk_manual_alloc_agent FOREIGN KEY (user_code) REFERENCES agents(user_code) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_auto_award_agent') THEN
        ALTER TABLE automatic_spin_awards ADD CONSTRAINT fk_auto_award_agent FOREIGN KEY (user_code) REFERENCES agents(user_code) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_spin_results_agent') THEN
        ALTER TABLE spin_results ADD CONSTRAINT fk_spin_results_agent FOREIGN KEY (user_code) REFERENCES agents(user_code) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

-- Prize stock can never go negative.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rewards_catalog_quantity') THEN
        ALTER TABLE rewards_catalog ADD CONSTRAINT chk_rewards_catalog_quantity CHECK (quantity IS NULL OR quantity >= 0);
    END IF;
END $$;
