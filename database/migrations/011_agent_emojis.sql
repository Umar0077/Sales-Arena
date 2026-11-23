-- Additive media storage: original bytes survive release directory changes.
CREATE TABLE IF NOT EXISTS agent_emoji_assets (
 id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL,
 width INT NOT NULL, height INT NOT NULL, content BYTEA NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS agent_emoji_assignments (
 agent_id VARCHAR(64) PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
 asset_id TEXT NOT NULL REFERENCES agent_emoji_assets(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
