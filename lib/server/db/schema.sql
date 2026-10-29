-- Sales Arena Production PostgreSQL Schema
-- Migration: 001_initial_schema.sql
-- Idempotent & Reversible

-- 1. CAMPAIGNS
CREATE TABLE IF NOT EXISTS campaigns (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    color VARCHAR(32) NOT NULL DEFAULT '#7568FF',
    product VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TEAMS
CREATE TABLE IF NOT EXISTS teams (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    color VARCHAR(32) NOT NULL DEFAULT '#7568FF',
    campaign_id VARCHAR(64) REFERENCES campaigns(id) ON DELETE SET NULL,
    lead_name VARCHAR(128) NOT NULL DEFAULT 'Unassigned',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. AGENTS & CLOSER MAPPINGS
CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR(64) PRIMARY KEY,
    user_code VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    initials VARCHAR(8) NOT NULL,
    team_id VARCHAR(64) REFERENCES teams(id) ON DELETE SET NULL,
    campaign_id VARCHAR(64) REFERENCES campaigns(id) ON DELETE SET NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    title VARCHAR(64) NOT NULL DEFAULT 'Closer',
    hue INT NOT NULL DEFAULT 240,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agents_user_code ON agents(user_code);
CREATE INDEX IF NOT EXISTS idx_agents_team_id ON agents(team_id);

-- 4. VALIDATED SALE RECORDS (Safe Quote confirmed sales)
CREATE TABLE IF NOT EXISTS validated_sales (
    id VARCHAR(64) PRIMARY KEY, -- sale_caseId or uuid
    case_id VARCHAR(128) UNIQUE NOT NULL,
    user_code VARCHAR(64) NOT NULL,
    agent_id VARCHAR(64) REFERENCES agents(id) ON DELETE SET NULL,
    state VARCHAR(8),
    carrier VARCHAR(64),
    coverage VARCHAR(64),
    premium NUMERIC(12, 2) NOT NULL DEFAULT 0,
    validated_at TIMESTAMPTZ NOT NULL,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    reward_processed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_user_code ON validated_sales(user_code);
CREATE INDEX IF NOT EXISTS idx_sales_validated_at ON validated_sales(validated_at);
CREATE INDEX IF NOT EXISTS idx_sales_reward_processed ON validated_sales(reward_processed);

-- 5. SALES EVENT INBOX (Idempotent event log for SSE and webhooks)
CREATE TABLE IF NOT EXISTS sales_events_inbox (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(128) UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    case_id VARCHAR(128),
    user_code VARCHAR(64),
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    error TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_processed ON sales_events_inbox(processed, received_at);
CREATE INDEX IF NOT EXISTS idx_events_case_id ON sales_events_inbox(case_id);

-- 6. SYNC CHECKPOINTS
CREATE TABLE IF NOT EXISTS sync_checkpoints (
    id VARCHAR(64) PRIMARY KEY,
    endpoint VARCHAR(128) NOT NULL,
    last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_event_id VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'idle',
    error TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. REWARD PROGRAMS (Daily, Weekly, Monthly)
CREATE TABLE IF NOT EXISTS reward_programs (
    id VARCHAR(64) PRIMARY KEY,
    kind VARCHAR(32) NOT NULL, -- 'daily', 'weekly', 'monthly'
    name VARCHAR(128) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sales_required INT NOT NULL DEFAULT 1,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 1000,
    prize_label VARCHAR(128) NOT NULL DEFAULT '',
    max_awards INT NOT NULL DEFAULT 10,
    start_date DATE,
    end_date DATE,
    headline VARCHAR(256) NOT NULL,
    message VARCHAR(256) NOT NULL,
    reward_line VARCHAR(256) NOT NULL,
    sound VARCHAR(32) NOT NULL DEFAULT 'target',
    accent VARCHAR(32) NOT NULL DEFAULT '#FFC857',
    popup_seconds INT NOT NULL DEFAULT 6,
    leaderboard_count INT NOT NULL DEFAULT 10,
    active_since TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. BONUS AWARDS (Audit-proof transactional award records)
CREATE TABLE IF NOT EXISTS bonus_awards (
    id VARCHAR(128) PRIMARY KEY, -- Deterministic: progId:userCode:periodKey:n
    program_id VARCHAR(64) NOT NULL REFERENCES reward_programs(id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL,
    agent_id VARCHAR(64),
    user_code VARCHAR(64) NOT NULL,
    agent_name VARCHAR(128) NOT NULL,
    period_key VARCHAR(32) NOT NULL, -- YYYY-MM-DD or YYYY-Www or YYYY-MM
    n INT NOT NULL, -- 1st, 2nd, etc. award for period
    validated_at_award INT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    prize_label VARCHAR(128) NOT NULL DEFAULT '',
    program_name VARCHAR(128) NOT NULL,
    sales_required INT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'earned', -- earned, approved, paid, cancelled
    trigger_sale_id VARCHAR(64) REFERENCES validated_sales(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bonus_user_period ON bonus_awards(user_code, period_key);
CREATE INDEX IF NOT EXISTS idx_bonus_program ON bonus_awards(program_id);

-- 9. TARGET RULES (Spin credit threshold configuration)
CREATE TABLE IF NOT EXISTS target_rules (
    id VARCHAR(64) PRIMARY KEY,
    team_id VARCHAR(64) REFERENCES teams(id) ON DELETE CASCADE,
    sales_per_spin INT NOT NULL DEFAULT 3,
    period VARCHAR(32) NOT NULL DEFAULT 'daily',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    team_daily_target INT NOT NULL DEFAULT 100,
    agent_daily_target INT NOT NULL DEFAULT 8,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. REWARDS CATALOG (Prizes for 3D Spinner)
CREATE TABLE IF NOT EXISTS rewards_catalog (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(128) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon VARCHAR(32) NOT NULL DEFAULT 'trophy',
    color VARCHAR(32) NOT NULL DEFAULT '#E0A526',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    quantity INT, -- NULL = unlimited
    initial_quantity INT,
    weight NUMERIC(8, 2) NOT NULL DEFAULT 1.0,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. SPIN CREDITS (Ledger for available spins per agent)
CREATE TABLE IF NOT EXISTS spin_credits (
    id VARCHAR(64) PRIMARY KEY, -- credit_userCode
    user_code VARCHAR(64) UNIQUE NOT NULL,
    agent_id VARCHAR(64) REFERENCES agents(id) ON DELETE SET NULL,
    earned INT NOT NULL DEFAULT 0,
    bonus INT NOT NULL DEFAULT 0,
    used INT NOT NULL DEFAULT 0,
    available INT NOT NULL DEFAULT 0,
    period_sales INT NOT NULL DEFAULT 0,
    sales_per_spin INT NOT NULL DEFAULT 3,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. SPIN RESULTS (Audit trail for spins and prizes won)
CREATE TABLE IF NOT EXISTS spin_results (
    id VARCHAR(64) PRIMARY KEY,
    user_code VARCHAR(64) NOT NULL,
    agent_id VARCHAR(64),
    reward_id VARCHAR(64) REFERENCES rewards_catalog(id) ON DELETE SET NULL,
    reward_title VARCHAR(128) NOT NULL,
    reward_color VARCHAR(32) NOT NULL,
    reward_icon VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'completed', -- in-progress, completed, fulfilled, cancelled
    mode VARCHAR(32) NOT NULL DEFAULT 'server', -- server, simulated, seeded-test
    seed BIGINT,
    segment_index INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spin_results_user ON spin_results(user_code);

-- 13. ADMIN SETTINGS (Persistent configuration)
CREATE TABLE IF NOT EXISTS admin_settings (
    key VARCHAR(128) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. CELEBRATION SETTINGS
CREATE TABLE IF NOT EXISTS celebration_settings (
    key VARCHAR(128) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. AUDIT LOGS
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor VARCHAR(128) NOT NULL DEFAULT 'system',
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(64),
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
