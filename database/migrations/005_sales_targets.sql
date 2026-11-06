-- 005: Editable validated-sales targets per business period (day / week / month).
-- period_key is the first business date of the period in America/New_York (YYYY-MM-DD).
-- A target of 0 means "not set". Every change is kept in sales_target_history.

CREATE TABLE IF NOT EXISTS sales_targets (
    id BIGSERIAL PRIMARY KEY,
    period_type VARCHAR(8) NOT NULL CHECK (period_type IN ('day', 'week', 'month')),
    period_key DATE NOT NULL,
    target INT NOT NULL CHECK (target >= 0 AND target <= 1000000),
    note VARCHAR(300),
    updated_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sales_targets_period UNIQUE (period_type, period_key)
);

CREATE TABLE IF NOT EXISTS sales_target_history (
    id BIGSERIAL PRIMARY KEY,
    target_id BIGINT NOT NULL REFERENCES sales_targets(id) ON DELETE CASCADE,
    period_type VARCHAR(8) NOT NULL CHECK (period_type IN ('day', 'week', 'month')),
    period_key DATE NOT NULL,
    old_target INT CHECK (old_target IS NULL OR old_target >= 0),
    new_target INT NOT NULL CHECK (new_target >= 0),
    note VARCHAR(300),
    changed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_target_history_period ON sales_target_history (period_type, period_key, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_target_history_changed ON sales_target_history (changed_at DESC);
