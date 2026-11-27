-- 012_spin_campaign_and_expire
-- Isolated spin_campaign_start_at setting (independent of cash bonus reward_activation_cutoff)
-- and auditable pre-campaign spin credit expiration ('expire' ledger kind). Additive & idempotent.

ALTER TABLE spin_credits ADD COLUMN IF NOT EXISTS expired INT NOT NULL DEFAULT 0;

DO $$
DECLARE
  c_name text;
BEGIN
  -- Replace the inline CHECK on spin_credit_transactions.kind so 'expire' is allowed.
  FOR c_name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'spin_credit_transactions'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE spin_credit_transactions DROP CONSTRAINT %I', c_name);
  END LOOP;
END $$;

ALTER TABLE spin_credit_transactions
  ADD CONSTRAINT chk_sct_kind CHECK (kind IN ('automatic', 'manual', 'consume', 'expire'));

ALTER TABLE spin_credit_transactions
  ADD CONSTRAINT chk_sct_sign CHECK (
    (kind IN ('consume', 'expire') AND quantity < 0)
    OR (kind IN ('automatic', 'manual') AND quantity > 0)
  );

ALTER TABLE spin_credit_transactions
  ADD CONSTRAINT chk_sct_manual_reason CHECK (kind <> 'manual' OR (reason IS NOT NULL AND length(btrim(reason)) >= 3));

ALTER TABLE spin_credit_transactions
  ADD CONSTRAINT chk_sct_manual_admin CHECK (kind <> 'manual' OR admin_id IS NOT NULL);

-- Default Spin & Win campaign start: November 27, 2026 00:00 America/New_York (05:00Z).
INSERT INTO admin_settings (key, value)
VALUES ('spin_campaign_start_at', '"2026-11-27T05:00:00.000Z"'::jsonb)
ON CONFLICT (key) DO NOTHING;
