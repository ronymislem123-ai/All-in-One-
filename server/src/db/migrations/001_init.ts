/**
 * Initial schema. Conventions:
 *  - Stable text IDs with type prefix (never names) as primary keys.
 *  - ISO-8601 UTC timestamps as TEXT.
 *  - JSON columns as TEXT validated in the application layer.
 *  - Soft deletion (deleted_at) for all user-facing entities; hard purge only from the trash.
 *  - Website, Claude and GitHub data live in separate tables/columns; provenance is recorded.
 */
export const sql = /* sql */ `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  password_changed_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_categories_parent ON categories(parent_id);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('project','subproject','module','submodule','feature','component','documentation','reference','note')),
  parent_id TEXT REFERENCES nodes(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  body TEXT,
  icon TEXT,
  color TEXT,
  url TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'planned'
    CHECK (lifecycle_status IN ('idea','planned','concept','in_development','claude_reported_done','released','unknown','unavailable')),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','technically_verified','functionally_tested')),
  verification_note TEXT,
  verified_at TEXT,
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 4),
  progress INTEGER CHECK (progress IS NULL OR progress BETWEEN 0 AND 100),
  nature TEXT NOT NULL DEFAULT 'organizational' CHECK (nature IN ('organizational','technical')),
  code_path TEXT,
  notes TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  review_state TEXT NOT NULL DEFAULT 'ok' CHECK (review_state IN ('ok','needs_review','possible_duplicate','unassigned')),
  origin TEXT NOT NULL DEFAULT 'website' CHECK (origin IN ('website','claude','github','import','idea')),
  field_sources TEXT NOT NULL DEFAULT '{}',
  claude_project_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_nodes_parent ON nodes(parent_id, sort_order);
CREATE INDEX idx_nodes_kind ON nodes(kind, deleted_at, archived_at);
CREATE INDEX idx_nodes_activity ON nodes(last_activity_at);
CREATE INDEX idx_nodes_category ON nodes(category_id);
CREATE INDEX idx_nodes_review ON nodes(review_state);

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  icon TEXT,
  color TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('hosted_web','external_url','internal','desktop','product_page')),
  launch_url TEXT,
  launch_hint TEXT,
  features TEXT NOT NULL DEFAULT '[]',
  availability TEXT NOT NULL DEFAULT 'unverified' CHECK (availability IN ('unverified','available','unreachable','manual_confirmed')),
  availability_note TEXT,
  last_check_at TEXT,
  last_check_status INTEGER,
  last_check_ms INTEGER,
  last_check_error TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT
);
CREATE INDEX idx_apps_node ON applications(node_id);

CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT,
  problem TEXT,
  goal TEXT,
  benefit TEXT,
  audience TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  subcategory_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  features TEXT NOT NULL DEFAULT '[]',
  highlights TEXT NOT NULL DEFAULT '[]',
  technologies TEXT NOT NULL DEFAULT '[]',
  prerequisites TEXT NOT NULL DEFAULT '[]',
  extensions TEXT NOT NULL DEFAULT '[]',
  risks TEXT NOT NULL DEFAULT '[]',
  complexity INTEGER CHECK (complexity IS NULL OR complexity BETWEEN 1 AND 5),
  effort TEXT CHECK (effort IS NULL OR effort IN ('xs','s','m','l','xl')),
  monetization_assessment TEXT,
  monetization_confidence TEXT CHECK (monetization_confidence IS NULL OR monetization_confidence IN ('plausibel','spekulativ','nicht-vorgesehen')),
  score_originality INTEGER,
  score_usefulness INTEGER,
  score_feasibility INTEGER,
  status TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered','saved','evaluating','converted','discarded')),
  favorite INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK (source IN ('library','claude','ai','manual','import')),
  source_detail TEXT,
  parent_idea_id TEXT REFERENCES ideas(id) ON DELETE SET NULL,
  variant_note TEXT,
  project_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  fingerprint TEXT NOT NULL,
  notes TEXT,
  seen_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_ideas_category ON ideas(category_id, subcategory_id);
CREATE INDEX idx_ideas_status ON ideas(status, favorite);
CREATE INDEX idx_ideas_fingerprint ON ideas(fingerprint);

CREATE TABLE knowledge_articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'einsteiger',
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  verification TEXT NOT NULL DEFAULT 'unverified' CHECK (verification IN ('verified','unverified','outdated')),
  verified_at TEXT,
  origin TEXT NOT NULL DEFAULT 'seed' CHECK (origin IN ('seed','manual')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);
CREATE TABLE entity_tags (
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY (tag_id, entity_type, entity_id)
);
CREATE INDEX idx_entity_tags_entity ON entity_tags(entity_type, entity_id);

CREATE TABLE external_identities (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('claude','github','import')),
  external_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('node','idea','application')),
  entity_id TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_event_id TEXT,
  last_payload TEXT,
  UNIQUE (source, entity_type, external_id)
);
CREATE INDEX idx_identities_entity ON external_identities(entity_type, entity_id);

CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  github_id INTEGER UNIQUE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  html_url TEXT,
  default_branch TEXT,
  private INTEGER NOT NULL DEFAULT 0,
  fork INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  primary_language TEXT,
  languages TEXT NOT NULL DEFAULT '{}',
  topics TEXT NOT NULL DEFAULT '[]',
  size_kb INTEGER,
  stars INTEGER,
  open_issues INTEGER,
  pushed_at TEXT,
  gh_created_at TEXT,
  gh_updated_at TEXT,
  head_sha TEXT,
  tree_truncated INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER,
  tracked INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','unreachable','not_found','error')),
  status_detail TEXT,
  last_synced_at TEXT,
  last_checked_at TEXT,
  added_via TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE repo_branches (
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sha TEXT NOT NULL,
  protected INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_id, name)
);

CREATE TABLE repo_commits (
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  sha TEXT NOT NULL,
  message TEXT NOT NULL,
  author_name TEXT,
  author_login TEXT,
  committed_at TEXT,
  html_url TEXT,
  PRIMARY KEY (repo_id, sha)
);
CREATE INDEX idx_repo_commits_time ON repo_commits(repo_id, committed_at);

CREATE TABLE repo_tree (
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  parent_path TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('blob','tree','commit')),
  size INTEGER,
  sha TEXT,
  depth INTEGER NOT NULL,
  PRIMARY KEY (repo_id, path)
);
CREATE INDEX idx_repo_tree_parent ON repo_tree(repo_id, parent_path);

CREATE TABLE code_files (
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  language TEXT,
  lines INTEGER,
  size INTEGER,
  imports TEXT NOT NULL DEFAULT '[]',
  external_imports TEXT NOT NULL DEFAULT '[]',
  exports TEXT NOT NULL DEFAULT '[]',
  role TEXT,
  excluded_reason TEXT,
  PRIMARY KEY (repo_id, path)
);

CREATE TABLE code_analyses (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commit_sha TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  stats TEXT NOT NULL DEFAULT '{}',
  error TEXT
);
CREATE INDEX idx_code_analyses_repo ON code_analyses(repo_id, started_at);

CREATE TABLE repo_dependencies (
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  manifest_path TEXT NOT NULL,
  ecosystem TEXT NOT NULL,
  name TEXT NOT NULL,
  version_spec TEXT,
  dev INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_id, manifest_path, name, dev)
);

CREATE TABLE project_repository_links (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('confirmed','suggested','rejected')),
  score REAL,
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (node_id, repository_id)
);
CREATE INDEX idx_links_repo ON project_repository_links(repository_id, status);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  trigger TEXT NOT NULL,
  label TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','partial','failed')),
  stats TEXT NOT NULL DEFAULT '{}',
  error TEXT
);
CREATE INDEX idx_sync_runs_time ON sync_runs(source, started_at);

CREATE TABLE sync_events (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES sync_runs(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received','applied','duplicate','conflict','rejected','failed')),
  target_type TEXT,
  target_id TEXT,
  message TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  client TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  UNIQUE (source, event_id)
);
CREATE INDEX idx_sync_events_status ON sync_events(status, received_at);
CREATE INDEX idx_sync_events_target ON sync_events(target_type, target_id);

CREATE TABLE conflicts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  source TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  candidates TEXT NOT NULL DEFAULT '[]',
  wait_key TEXT,
  resolution TEXT,
  resolution_note TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  sync_event_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_conflicts_status ON conflicts(status, created_at);
CREATE INDEX idx_conflicts_subject ON conflicts(subject_type, subject_id);
CREATE INDEX idx_conflicts_wait ON conflicts(wait_key, status);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  entity_name TEXT,
  project_id TEXT,
  summary TEXT NOT NULL,
  data TEXT
);
CREATE INDEX idx_activity_time ON activity(at);
CREATE INDEX idx_activity_entity ON activity(entity_type, entity_id);
CREATE INDEX idx_activity_project ON activity(project_id, at);

CREATE TABLE entity_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  change_kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX idx_versions_entity ON entity_versions(entity_type, entity_id, version);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('info','success','warning','error')),
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  dedupe_key TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX idx_notifications_time ON notifications(read_at, created_at);

CREATE TABLE preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE secrets (
  key TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  hint TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE http_cache (
  url TEXT PRIMARY KEY,
  etag TEXT,
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'screenshot',
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);

CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  title,
  body,
  extra,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);
`;
