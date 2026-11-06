-- 009: Highest-achieved-tier bonuses with auditable supersession, and Owner-approved sale contributions.
-- Never changes an existing award's amount, status, period or agent. Never deletes anything.

-- Programs: how tiers combine. Programs of the same kind + reward_group with tier_policy = 'highest_tier'
-- compete: only the highest achieved milestone is the agent's effective bonus for that period.
-- 'additive' programs pay independently (the previous behaviour), for incentives meant to coexist.
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS tier_policy VARCHAR(16) NOT NULL DEFAULT 'highest_tier';
ALTER TABLE reward_programs ADD COLUMN IF NOT EXISTS reward_group VARCHAR(64) NOT NULL DEFAULT 'default';
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_reward_programs_tier') THEN
        ALTER TABLE reward_programs ADD CONSTRAINT chk_reward_programs_tier
            CHECK (tier_policy IN ('highest_tier', 'additive') AND length(btrim(reward_group)) > 0) NOT VALID;
    END IF;
END $$;

-- Awards: supersession chain + payment accounting.
--   superseded_by / superseded_at : this award was replaced by a higher tier (kept for history)
--   supersedes_id                 : the award this one replaced
--   previous_amount               : effective entitlement just before this award
--   increment_amount              : entitlement increase (amount - previous_amount)
--   payable_amount                : cash this award is responsible for paying (an unpaid superseded award
--                                   folds into its successor and pays 0; a paid one keeps what it paid)
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS tier_policy VARCHAR(16) NOT NULL DEFAULT 'additive';
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS reward_group VARCHAR(64) NOT NULL DEFAULT 'default';
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS superseded_by VARCHAR(128) REFERENCES bonus_awards(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS supersedes_id VARCHAR(128) REFERENCES bonus_awards(id) ON DELETE RESTRICT;
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS previous_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS increment_amount NUMERIC(12, 2);
ALTER TABLE bonus_awards ADD COLUMN IF NOT EXISTS payable_amount NUMERIC(12, 2);
UPDATE bonus_awards SET increment_amount = amount WHERE increment_amount IS NULL;
UPDATE bonus_awards SET payable_amount = amount WHERE payable_amount IS NULL;
ALTER TABLE bonus_awards ALTER COLUMN increment_amount SET NOT NULL;
ALTER TABLE bonus_awards ALTER COLUMN payable_amount SET NOT NULL;

-- Existing awards take their program's policy and group (snapshot). Amounts and statuses are untouched.
UPDATE bonus_awards a SET tier_policy = p.tier_policy, reward_group = p.reward_group
  FROM reward_programs p WHERE p.id = a.program_id AND a.reward_type = 'cash';
-- An agent/period that already holds several cash awards from the additive era keeps them as issued:
-- only the highest tier joins the new chain; the others stay 'additive' (effective, never re-written).
WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_code, kind, reward_group, period_key ORDER BY sales_required DESC, created_at DESC, id DESC) AS rn
      FROM bonus_awards
     WHERE tier_policy = 'highest_tier' AND reward_type = 'cash' AND superseded_by IS NULL AND status NOT IN ('cancelled', 'reversed')
)
UPDATE bonus_awards b SET tier_policy = 'additive' FROM ranked r WHERE r.id = b.id AND r.rn > 1;

-- At most ONE effective highest-tier cash award per agent, kind, group and business period.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bonus_awards_effective_tier
    ON bonus_awards (user_code, kind, reward_group, period_key)
 WHERE tier_policy = 'highest_tier' AND reward_type = 'cash' AND superseded_by IS NULL AND status NOT IN ('cancelled', 'reversed');
CREATE INDEX IF NOT EXISTS idx_bonus_awards_chain ON bonus_awards (user_code, kind, reward_group, period_key);

-- Sales the Owner explicitly approved to count for a kind / group / period even though the automatic rule
-- excludes them (validated before the program's activation). Used consistently by every later tier.
CREATE TABLE IF NOT EXISTS bonus_sale_approvals (
    id BIGSERIAL PRIMARY KEY,
    sale_id VARCHAR(64) NOT NULL REFERENCES validated_sales(id) ON DELETE RESTRICT,
    user_code VARCHAR(64) NOT NULL,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('daily', 'weekly', 'monthly')),
    reward_group VARCHAR(64) NOT NULL,
    period_key VARCHAR(32) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    approved_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_award_id VARCHAR(128) REFERENCES bonus_awards(id) ON DELETE SET NULL,
    CONSTRAINT uq_bonus_sale_approval UNIQUE (sale_id, kind, reward_group, period_key)
);
CREATE INDEX IF NOT EXISTS idx_bonus_sale_approvals_lookup ON bonus_sale_approvals (user_code, kind, reward_group, period_key);

-- Earlier Owner recoveries already approved specific sales (listed in their audit entry): record those
-- approvals so higher tiers can count them. This creates NO award.
INSERT INTO bonus_sale_approvals (sale_id, user_code, kind, reward_group, period_key, reason, approved_by, approved_at, source_award_id)
SELECT DISTINCT ON (s.id, a.kind, a.reward_group, a.period_key)
       s.id, a.user_code, a.kind, a.reward_group, a.period_key, COALESCE(a.recovery_reason, 'Owner recovery'), a.recovered_by, COALESCE(a.recovered_at, a.created_at), a.id
  FROM bonus_awards a
  JOIN audit_logs l ON l.action = 'bonus_award.recovered' AND l.target_id = a.id
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.details -> 'salesCounted') = 'array' THEN l.details -> 'salesCounted' ELSE '[]'::jsonb END) AS c(case_id)
  JOIN validated_sales s ON s.case_id = c.case_id AND s.user_code = a.user_code
 WHERE a.source = 'recovery'
ON CONFLICT DO NOTHING;
