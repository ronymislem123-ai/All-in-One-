/**
 * Shared domain vocabulary for OMEGA Infinity.
 * Used by server, web UI and MCP server so that every layer speaks the same language.
 */

// ── Object types ────────────────────────────────────────────────────────────
export const NODE_KINDS = [
  'project',
  'subproject',
  'module',
  'submodule',
  'feature',
  'component',
  'documentation',
  'reference',
  'note',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  project: 'Hauptprojekt',
  subproject: 'Unterprojekt',
  module: 'Modul',
  submodule: 'Untermodul',
  feature: 'Funktion',
  component: 'Technische Komponente',
  documentation: 'Dokumentation',
  reference: 'Externe Referenz',
  note: 'Information',
};

/** Kinds that form the "project" level (shown in the library). */
export const PROJECT_LEVEL_KINDS: NodeKind[] = ['project', 'subproject'];

// ── Status model (three independent axes – never mixed) ────────────────────
/** Axis 1: Concept / lifecycle (owned by Claude reports or the website). */
export const LIFECYCLE_STATUSES = [
  'idea',
  'planned',
  'concept',
  'in_development',
  'claude_reported_done',
  'released',
  'unknown',
  'unavailable',
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];
export const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  idea: 'Idee',
  planned: 'Geplant',
  concept: 'Konzept vorhanden',
  in_development: 'In Entwicklung',
  claude_reported_done: 'Von Claude als abgeschlossen beschrieben',
  released: 'Veröffentlicht',
  unknown: 'Unbekannt',
  unavailable: 'Nicht verfügbar',
};

/** Axis 2: Code presence (derived from GitHub data – never set manually). */
export const CODE_STATUSES = ['not_linked', 'detected', 'missing', 'unreachable', 'pending'] as const;
export type CodeStatus = (typeof CODE_STATUSES)[number];
export const CODE_STATUS_LABELS: Record<CodeStatus, string> = {
  not_linked: 'Kein Repository verknüpft',
  detected: 'In GitHub erkannt',
  missing: 'In GitHub nicht gefunden',
  unreachable: 'Repository nicht erreichbar',
  pending: 'GitHub-Abgleich ausstehend',
};

/** Axis 3: Verification (set by the owner with evidence). */
export const VERIFICATION_STATUSES = ['unverified', 'technically_verified', 'functionally_tested'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  unverified: 'Nicht geprüft',
  technically_verified: 'Technisch geprüft',
  functionally_tested: 'Funktional getestet',
};

export const NODE_NATURES = ['organizational', 'technical'] as const;
export type NodeNature = (typeof NODE_NATURES)[number];
export const NODE_NATURE_LABELS: Record<NodeNature, string> = {
  organizational: 'Organisatorisch (Website-Struktur)',
  technical: 'Technisch (Softwaremodul)',
};

export const REVIEW_STATES = ['ok', 'needs_review', 'possible_duplicate', 'unassigned'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];
export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  ok: 'In Ordnung',
  needs_review: 'Prüfung nötig',
  possible_duplicate: 'Mögliches Duplikat',
  unassigned: 'Nicht zugeordnet',
};

export const ORIGINS = ['website', 'claude', 'github', 'import', 'idea'] as const;
export type Origin = (typeof ORIGINS)[number];
export const ORIGIN_LABELS: Record<Origin, string> = {
  website: 'Website',
  claude: 'Claude',
  github: 'GitHub',
  import: 'Import',
  idea: 'AI Idea Hub',
};

export const PRIORITY_LABELS = ['Kritisch', 'Hoch', 'Normal', 'Niedrig', 'Irgendwann'] as const;

// ── Applications ───────────────────────────────────────────────────────────
export const APP_KINDS = ['hosted_web', 'external_url', 'internal', 'desktop', 'product_page'] as const;
export type AppKind = (typeof APP_KINDS)[number];
export const APP_KIND_LABELS: Record<AppKind, string> = {
  hosted_web: 'Gehostete Web-App',
  external_url: 'Externe App-URL',
  internal: 'Interne Anwendung',
  desktop: 'Desktop-Anwendung',
  product_page: 'Produktseite',
};

export const APP_AVAILABILITY = ['unverified', 'available', 'unreachable', 'manual_confirmed'] as const;
export type AppAvailability = (typeof APP_AVAILABILITY)[number];
export const APP_AVAILABILITY_LABELS: Record<AppAvailability, string> = {
  unverified: 'Nicht geprüft',
  available: 'Verfügbar (geprüft)',
  unreachable: 'Nicht erreichbar',
  manual_confirmed: 'Manuell bestätigt',
};

// ── Ideas ──────────────────────────────────────────────────────────────────
export const IDEA_STATUSES = ['discovered', 'saved', 'evaluating', 'converted', 'discarded'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  discovered: 'Entdeckt',
  saved: 'Gespeichert',
  evaluating: 'In Prüfung',
  converted: 'Als Projekt übernommen',
  discarded: 'Verworfen',
};

export const EFFORTS = ['xs', 's', 'm', 'l', 'xl'] as const;
export type Effort = (typeof EFFORTS)[number];
export const EFFORT_LABELS: Record<Effort, string> = {
  xs: 'XS · ein Nachmittag',
  s: 'S · wenige Tage',
  m: 'M · 1–3 Wochen',
  l: 'L · 1–3 Monate',
  xl: 'XL · großes Produkt',
};

export const IDEA_SOURCES = ['library', 'claude', 'ai', 'manual', 'import'] as const;
export type IdeaSource = (typeof IDEA_SOURCES)[number];
export const IDEA_SOURCE_LABELS: Record<IdeaSource, string> = {
  library: 'Kuratierte Bibliothek',
  claude: 'Von Claude übermittelt',
  ai: 'KI-generiert (Claude API)',
  manual: 'Manuell erfasst',
  import: 'Importiert',
};

export const MONETIZATION_CONFIDENCE = ['plausibel', 'spekulativ', 'nicht-vorgesehen'] as const;
export type MonetizationConfidence = (typeof MONETIZATION_CONFIDENCE)[number];

export const IDEA_DISCOVERY_MODES = [
  { id: 'discover', label: 'Neue Ideen entdecken', description: 'Zufällige Auswahl, bevorzugt noch nicht gesehene Ideen.' },
  { id: 'category', label: 'Nach Kategorie', description: 'Ideen einer bestimmten Kategorie.' },
  { id: 'problem', label: 'Lösung für ein Problem', description: 'Volltextsuche über Problemstellung, Nutzen und Funktionen.' },
  { id: 'unusual', label: 'Besonders ungewöhnlich', description: 'Höchste Originalität zuerst.' },
  { id: 'quick-wins', label: 'Kleine Tools', description: 'Geringer Entwicklungsaufwand (XS/S), hohe Umsetzbarkeit.' },
  { id: 'big-projects', label: 'Große Softwareprojekte', description: 'Aufwand L/XL.' },
  { id: 'business', label: 'Business-Ideen', description: 'Ideen mit plausibler wirtschaftlicher Verwertbarkeit.' },
  { id: 'high-impact', label: 'Hoher praktischer Nutzen', description: 'Nutzenbewertung zuerst.' },
  { id: 'extend-project', label: 'Bestehende Projekte erweitern', description: 'Ideen passend zur Kategorie eines Projekts.' },
  { id: 'combine', label: 'Ideen kombinieren', description: 'Zwei Ideen zu einem Konzept verbinden.' },
  { id: 'automation', label: 'Prozesse automatisieren', description: 'Automatisierungs- und Agenten-Ideen.' },
  { id: 'claude', label: 'Neue Einsatzmöglichkeiten für Claude', description: 'Claude-Workflows, MCP und Agenten.' },
  { id: 'audience', label: 'Für eine Zielgruppe', description: 'Volltextsuche über die Zielgruppe.' },
  { id: 'improve', label: 'Bestehende Funktionen verbessern', description: 'Erweiterungsvorschläge der Ideen.' },
] as const;
export type IdeaDiscoveryMode = (typeof IDEA_DISCOVERY_MODES)[number]['id'];

// ── Sync / conflicts ───────────────────────────────────────────────────────
export const SYNC_SOURCES = ['claude', 'github', 'file', 'system'] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

export const SYNC_EVENT_STATUSES = ['received', 'applied', 'duplicate', 'conflict', 'rejected', 'failed'] as const;
export type SyncEventStatus = (typeof SYNC_EVENT_STATUSES)[number];
export const SYNC_EVENT_STATUS_LABELS: Record<SyncEventStatus, string> = {
  received: 'Empfangen',
  applied: 'Übernommen',
  duplicate: 'Bereits verarbeitet',
  conflict: 'Konflikt',
  rejected: 'Abgelehnt',
  failed: 'Fehlgeschlagen',
};

export const CONFLICT_TYPES = [
  'possible_duplicate',
  'unresolved_parent',
  'field_conflict',
  'repo_ambiguous',
  'repo_unreachable',
] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];
export const CONFLICT_TYPE_LABELS: Record<ConflictType, string> = {
  possible_duplicate: 'Mögliches Duplikat',
  unresolved_parent: 'Elternobjekt unbekannt',
  field_conflict: 'Abweichende Daten',
  repo_ambiguous: 'Mehrdeutige Repository-Zuordnung',
  repo_unreachable: 'Repository nicht erreichbar',
};

export const CONFLICT_RESOLUTIONS: Record<ConflictType, { id: string; label: string; description: string }[]> = {
  possible_duplicate: [
    { id: 'use_existing', label: 'Bestehendes Projekt verwenden', description: 'Die Claude-Identität wird auf das gewählte bestehende Objekt übertragen; der vorläufige Eintrag wandert in den Papierkorb.' },
    { id: 'create_new', label: 'Als neues Objekt behalten', description: 'Der Eintrag bleibt ein eigenständiges Objekt.' },
    { id: 'as_submodule', label: 'Als Untermodul zuordnen', description: 'Der Eintrag wird unter das gewählte Objekt verschoben.' },
    { id: 'mark_duplicate', label: 'Als mögliches Duplikat markieren', description: 'Beide bleiben bestehen und werden sichtbar markiert.' },
    { id: 'keep_separate', label: 'Vorläufig getrennt speichern', description: 'Keine Änderung; der Konflikt wird geschlossen.' },
  ],
  unresolved_parent: [
    { id: 'assign_parent', label: 'Elternobjekt zuordnen', description: 'Den Eintrag unter ein gewähltes Objekt verschieben.' },
    { id: 'keep_unassigned', label: 'Als eigenständiges Objekt behalten', description: 'Der Eintrag bleibt auf oberster Ebene.' },
  ],
  field_conflict: [
    { id: 'keep_website', label: 'Website-Stand beibehalten', description: 'Der Claude-Wert wird verworfen (bleibt im Protokoll erhalten).' },
    { id: 'accept_claude', label: 'Claude-Stand übernehmen', description: 'Der Website-Wert wird versioniert und durch den Claude-Wert ersetzt.' },
  ],
  repo_ambiguous: [
    { id: 'link_candidate', label: 'Mit gewähltem Projekt verknüpfen', description: 'Bestätigte Verknüpfung über die stabile Repository-ID.' },
    { id: 'ignore', label: 'Keine Verknüpfung', description: 'Vorschläge verwerfen.' },
  ],
  repo_unreachable: [
    { id: 'keep_link', label: 'Verknüpfung beibehalten', description: 'Daten bleiben erhalten; das Repository wird weiter geprüft.' },
    { id: 'unlink', label: 'Verknüpfung lösen', description: 'Nur die Verknüpfung wird entfernt – Projekt und Repository-Daten bleiben erhalten.' },
  ],
};

export const ACTORS = ['user', 'claude', 'github', 'system', 'import'] as const;
export type Actor = (typeof ACTORS)[number];
export const ACTOR_LABELS: Record<Actor, string> = {
  user: 'Du',
  claude: 'Claude',
  github: 'GitHub',
  system: 'System',
  import: 'Import',
};

/** Status colours (§19.4): green success · yellow attention · red critical · grey not set up/unknown. */
export type Health = 'ok' | 'attention' | 'critical' | 'unknown';

export const API_TOKEN_SCOPES = ['ingest', 'read'] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];
