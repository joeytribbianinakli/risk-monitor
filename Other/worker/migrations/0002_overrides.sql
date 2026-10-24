-- User can override a source-derived risk assessment without deleting the underlying source value.
CREATE TABLE IF NOT EXISTS overrides (
 key TEXT PRIMARY KEY REFERENCES checks(key) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK (status IN ('clear','watch','serious','review')),
 note TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
