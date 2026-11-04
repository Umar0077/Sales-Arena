-- 010: Teams Arena (effective-dated team memberships and Senior / Junior designations) and the reward
-- programme audience. Schema only: no team, membership, designation or programme row is created or changed.
-- Never touches validated_sales or bonus_awards.

-- Teams: the existing (unused) teams table, extended. Team names / logos / colours are Admin data.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS slug VARCHAR(64);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo_url TEXT;                 -- bundled "/teams/<file>" or an uploaded data: image
ALTER TABLE teams ADD COLUMN IF NOT EXISTS accent_secondary VARCHAR(32);  -- second accent (teams.color is the first)
-- No foreign key on purpose: teams is referenced by target_rules (ON DELETE CASCADE), and a key from teams to
-- agents would let an agents cleanup cascade into the spin rules. The leader is validated by the application.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS leader_user_code VARCHAR(64);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_slug ON teams (slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_name_ci ON teams (lower(name)) WHERE slug IS NOT NULL;

-- Memberships: business-date ranges [effective_from, effective_to). An open membership has effective_to NULL.
-- One agent has at most one open membership (unique index); overlapping ranges are prevented by the
-- transactional assignment code (per-agent lock). Ending a membership never deletes it (history).
CREATE TABLE IF NOT EXISTS team_memberships (
    id BIGSERIAL PRIMARY KEY,
    team_id VARCHAR(64) NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    user_code VARCHAR(64) NOT NULL REFERENCES agents(user_code) ON DELETE RESTRICT ON UPDATE CASCADE,
    effective_from DATE NOT NULL,
    effective_to DATE,
    assigned_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    ended_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    note VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_team_membership_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_memberships_open ON team_memberships (user_code) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_memberships_team ON team_memberships (team_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_team_memberships_agent ON team_memberships (user_code, effective_from);

-- Sales designation (a business classification, NOT an Admin permission), effective-dated the same way.
CREATE TABLE IF NOT EXISTS agent_designations (
    id BIGSERIAL PRIMARY KEY,
    user_code VARCHAR(64) NOT NULL REFERENCES agents(user_code) ON DELETE RESTRICT ON UPDATE CASCADE,
    designation VARCHAR(8) NOT NULL CHECK (designation IN ('senior', 'junior')),
    effective_from DATE NOT NULL,
    effective_to DATE,
    set_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_agent_designation_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_designations_open ON agent_designations (user_code) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_designations_agent ON agent_designations (user_code, effective_from);

-- Reward programme audience. Existing programmes keep 'all' (exactly today's behaviour) until the Owner
-- approves a scope change in Admin. Junior programmes use their own reward groups ("junior…"), so a Senior
-- and a Junior tier chain can never supersede each other.
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS audience VARCHAR(8) NOT NULL DEFAULT 'all';
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_reward_programs_audience') THEN
        ALTER TABLE reward_programs ADD CONSTRAINT chk_reward_programs_audience CHECK (
            audience IN ('all', 'senior', 'junior')
            AND ((audience = 'junior') = (reward_group LIKE 'junior%'))
        ) NOT VALID;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_reward_programs_audience ON reward_programs (audience, kind);
