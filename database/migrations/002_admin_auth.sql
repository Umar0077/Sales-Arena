-- 002_admin_auth
-- Standalone administrator accounts, database-backed sessions and login throttling.
-- Admin credentials are independent of the Safe Quote API token.
-- Additive only: no existing table is dropped or rewritten.

CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(254) NOT NULL,
    display_name VARCHAR(128) NOT NULL DEFAULT '',
    -- Argon2id PHC string, e.g. $argon2id$v=19$m=19456,t=2,p=1$...
    password_hash TEXT NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
    role VARCHAR(16) NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_email ON admin_users (LOWER(email));

-- Sessions: only the SHA-256 of the random session token is stored.
CREATE TABLE IF NOT EXISTS admin_sessions (
    id VARCHAR(64) PRIMARY KEY,
    admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Absolute lifetime and sliding idle timeout.
    expires_at TIMESTAMPTZ NOT NULL,
    idle_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    ip_address VARCHAR(45),
    user_agent VARCHAR(256)
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

-- Login attempts for rate limiting (email stored as a SHA-256 hash, not plaintext).
CREATE TABLE IF NOT EXISTS admin_login_attempts (
    id BIGSERIAL PRIMARY KEY,
    email_hash VARCHAR(64) NOT NULL,
    ip_address VARCHAR(45),
    success BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON admin_login_attempts(email_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON admin_login_attempts(ip_address, created_at DESC);

-- Audit entries can now point at the admin who acted.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent VARCHAR(256);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_id, created_at DESC);
