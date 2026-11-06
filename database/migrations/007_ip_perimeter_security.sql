-- 007: IP perimeter security (application-level allowlist). Additive only.
-- The restriction starts DISABLED: nothing changes for any visitor until an Owner enables it.

CREATE TABLE IF NOT EXISTS ip_security_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),          -- exactly one row
    enabled BOOLEAN NOT NULL DEFAULT FALSE,                     -- master switch
    protect_arena BOOLEAN NOT NULL DEFAULT TRUE,                -- /, Live Arena pages, /api/arena/*
    protect_pairing BOOLEAN NOT NULL DEFAULT TRUE,              -- /pair, /api/arena/device/*
    protect_admin BOOLEAN NOT NULL DEFAULT FALSE,               -- /admin/*, /api/admin/* (management rules only)
    revision BIGINT NOT NULL DEFAULT 1,                         -- bumped on every settings / rule change
    updated_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO ip_security_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ip_whitelist_rules (
    id BIGSERIAL PRIMARY KEY,
    network CIDR NOT NULL,                                      -- single address = /32 (IPv4) or /128 (IPv6)
    label VARCHAR(80) NOT NULL CHECK (length(btrim(label)) > 0),
    description VARCHAR(500) NOT NULL DEFAULT '',
    notes VARCHAR(1000) NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    allow_management BOOLEAN NOT NULL DEFAULT FALSE,            -- may also reach the Admin Panel when it is protected
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,                                    -- soft delete: kept for the audit trail
    archived_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_via VARCHAR(16) NOT NULL DEFAULT 'admin' CHECK (created_via IN ('admin', 'current_ip', 'console'))
);

-- No two live (non-archived) rules may overlap: one address always has one unambiguous rule.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ex_ip_rules_no_overlap') THEN
        ALTER TABLE ip_whitelist_rules ADD CONSTRAINT ex_ip_rules_no_overlap
            EXCLUDE USING gist (network inet_ops WITH &&) WHERE (archived_at IS NULL);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_ip_rules_effective ON ip_whitelist_rules (active, expires_at) WHERE archived_at IS NULL;
