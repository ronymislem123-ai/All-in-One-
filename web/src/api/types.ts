// Response shapes of the OMEGA API (kept in one place for the UI).
import type { Health } from '@shared/domain';

export interface User { id: string; email: string; displayName: string }
export interface AuthState { setupRequired: boolean; authenticated: boolean; user: User | null }

export interface CategoryRef { id: string; name: string | null; color: string | null; icon: string | null; slug?: string | null }
export interface Category { id: string; parent_id: string | null; slug: string; name: string; description: string | null; icon: string | null; color: string | null; sort_order: number; system: number; idea_count: number; node_count: number; app_count: number; children: Category[] }

export interface CodeStatusInfo { status: 'not_linked' | 'detected' | 'missing' | 'unreachable' | 'pending'; repoId?: string; repoName?: string; detail?: string }

export interface NodeDto {
  id: string; kind: string; kindLabel: string; parentId: string | null; name: string; summary: string | null; description: string | null; body: string | null;
  icon: string | null; color: string | null; url: string | null; categoryId: string | null; lifecycleStatus: string; verificationStatus: string;
  verificationNote: string | null; verifiedAt: string | null; priority: number; progress: number | null; nature: string; codePath: string | null;
  notes: string | null; favorite: boolean; reviewState: string; origin: string; fieldSources: Record<string, { src: string; at: string }>;
  claudeProjectUrl: string | null; version: number; createdAt: string; updatedAt: string; lastActivityAt: string; archivedAt: string | null; deletedAt: string | null;
}
export interface NodeListItem extends NodeDto { childCount: number; repoCount: number; appCount: number; openConflicts: number; category: CategoryRef | null; tags: string[] }
export interface NodeChild extends NodeDto { childCount: number; codeStatus: CodeStatusInfo }
export interface HealthInfo { score: number; health: Health; factors: { key: string; label: string; ok: boolean; weight: number; detail: string }[] }
export interface NodeDetail {
  node: NodeDto; ancestors: { id: string; name: string; kind: string }[]; children: NodeChild[]; descendants: number;
  identities: { source: string; external_id: string; confirmed: number; first_seen_at: string; last_seen_at: string }[];
  repoLinks: { id: string; status: string; score: number | null; reason: string | null; created_by: string; repo_id: string; full_name: string; html_url: string | null; repo_status: string; primary_language: string | null; last_synced_at: string | null; pushed_at: string | null; default_branch: string | null; private: number }[];
  apps: { id: string; name: string; kind: string; availability: string; launch_url: string | null; icon: string | null; color: string | null }[];
  category: { id: string; name: string; color: string | null; icon: string | null; slug: string } | null;
  tags: string[]; sourceIdea: { id: string; title: string } | null; openConflicts: { id: string; type: string; title: string; severity: string; created_at: string }[];
  codeStatus: CodeStatusInfo; health: HealthInfo; attachments: { id: string; kind: string; filename: string; mime: string; size: number; created_at: string }[];
}

export interface AppDto {
  id: string; nodeId: string | null; project: { id: string; name: string } | null; name: string; summary: string | null; description: string | null;
  icon: string | null; color: string | null; categoryId: string | null; kind: string; kindLabel: string; launchUrl: string | null; launchHint: string | null;
  features: string[]; availability: string; availabilityNote: string | null; lastCheck: { at: string; status: number | null; ms: number | null; error: string | null } | null;
  favorite: boolean; lastOpenedAt: string | null; version: number; createdAt: string; updatedAt: string; archivedAt: string | null; tags: string[];
}

export interface IdeaDto {
  id: string; slug: string; title: string; summary: string; description: string | null; problem: string | null; goal: string | null; benefit: string | null;
  audience: string | null; categoryId: string | null; subcategoryId: string | null; category: CategoryRef | null; subcategoryName: string | null;
  features: string[]; highlights: string[]; technologies: string[]; prerequisites: string[]; extensions: string[]; risks: string[];
  complexity: number | null; effort: string | null; monetization: { assessment: string | null; confidence: string | null };
  scores: { originality: number | null; usefulness: number | null; feasibility: number | null }; status: string; favorite: boolean;
  source: string; sourceLabel: string; sourceDetail: string | null; parentIdeaId: string | null; variantNote: string | null;
  projectNodeId: string | null; projectName: string | null; notes: string | null; seenAt: string | null; version: number; createdAt: string; tags: string[];
}

export interface ActivityItem { id: number; at: string; actor: string; action: string; entity_type: string | null; entity_id: string | null; entity_name: string | null; project_id?: string | null; summary: string; data?: unknown }

export interface IntegrationInfo { health: Health; label: string; description: string; [k: string]: unknown }
export interface Integrations { claude: IntegrationInfo & { tokens: number; lastIngestAt: string | null; note: string }; github: IntegrationInfo & { tokenSource: string | null; webhookConfigured: boolean; repos: { total: number; ok: number; bad: number } }; ai: IntegrationInfo & { configured: boolean; model: string }; database: IntegrationInfo; backup: IntegrationInfo & BackupStatus }

export interface BackupMeta { name: string; kind: string; createdAt: string; size: number; sha256: string; encrypted: boolean; schemaVersion: number; counts: Record<string, number>; note: string | null; verified: { at: string; ok: boolean; detail: string } | null; external: { copied: boolean; path: string | null; error: string | null } | null }
export interface BackupStatus { health: Health; last: BackupMeta | null; count: number; totalBytes: number; intervalMinutes: number; lastScheduledCheckAt: string | null; nextScheduledAt: string | null; changedSinceLastBackup: boolean; encryption: boolean; external: { configured: boolean; dir: string | null }; lastError: string | null; lastRestore: { at: string; type: string; backup: string; ok: boolean; detail: string } | null; directory: string }

export interface Dashboard {
  counts: Record<string, number>;
  ideas: { total: number; saved: number; favorites: number; converted: number; ai: number; library: number; unseen: number };
  recent: { id: string; name: string; summary: string | null; status: string; progress: number | null; color: string | null; icon: string | null; category: string | null; lastActivityAt: string; health: HealthInfo }[];
  favorites: { type: string; id: string; name: string; sub: string; link: string }[];
  activity: ActivityItem[];
  integrations: Integrations;
  quality: { total: number; top: QualityIssue[] };
  recommendations: { id: string; title: string; reason: string; link: string; action: string }[];
}
export interface QualityIssue { id: string; severity: 'info' | 'warning'; type: string; title: string; detail: string; link: string }

export interface Repo { id: string; githubId: number | null; owner: string; name: string; fullName: string; description: string | null; htmlUrl: string | null; defaultBranch: string | null; private: boolean; archived: boolean; primaryLanguage: string | null; languages: Record<string, number>; topics: string[]; pushedAt: string | null; headSha: string | null; fileCount: number | null; tracked: boolean; status: string; statusDetail: string | null; lastSyncedAt: string | null; addedVia: string; linked?: number }

export interface ConflictDto { id: string; type: string; typeLabel: string; status: string; severity: string; source: string; subjectType: string; subjectId: string; subject: { id: string; name: string; [k: string]: unknown } | null; title: string; description: string | null; details: Record<string, unknown>; candidates: { id: string; name: string; score?: number; reason?: string }[]; resolution: string | null; resolutionNote: string | null; resolvedAt: string | null; createdAt: string; options: { id: string; label: string; description: string }[] }

export interface SearchHit { type: string; id: string; title: string; snippet: string; subtitle?: string; link: string }

export interface Preferences { theme: 'system' | 'dark' | 'light'; density: 'comfortable' | 'compact'; motion: 'system' | 'reduced' | 'full'; dashboardWidgets: string[]; hiddenWidgets: string[]; librarySort: string; libraryView: 'grid' | 'list' | 'tree'; explainLevel: 'simple' | 'technical'; robotEnabled: boolean }
