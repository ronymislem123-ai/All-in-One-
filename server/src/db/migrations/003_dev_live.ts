/**
 * "Werkstatt" – live development sessions streamed by Claude (omega.live/v1).
 * Display-only data: nothing here feeds back into project fields (ADR-014).
 */
export const sql = /* sql */ `
CREATE TABLE dev_sessions (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  goal TEXT,
  state TEXT NOT NULL DEFAULT 'planning' CHECK (state IN ('planning','building','testing','done','paused')),
  phase TEXT,
  progress REAL,
  now_text TEXT,
  preview_url TEXT,
  preview_note TEXT,
  project_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'claude',
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_event_at TEXT,
  ended_at TEXT
);
CREATE INDEX idx_dev_sessions_updated ON dev_sessions(updated_at);
CREATE INDEX idx_dev_sessions_project ON dev_sessions(project_id);

CREATE TABLE dev_milestones (
  session_id TEXT NOT NULL REFERENCES dev_sessions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','done')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, key)
);

CREATE TABLE dev_tasks (
  session_id TEXT NOT NULL REFERENCES dev_sessions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done','blocked')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, key)
);

CREATE TABLE dev_media (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES dev_sessions(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, sha256)
);

CREATE TABLE dev_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES dev_sessions(id) ON DELETE CASCADE,
  event_id TEXT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data TEXT,
  media_id TEXT REFERENCES dev_media(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, event_id)
);
CREATE INDEX idx_dev_events_session ON dev_events(session_id, id);
`;
