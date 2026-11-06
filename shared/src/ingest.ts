/**
 * omega.ingest/v1 – the versioned, validated exchange format for structured information
 * coming from Claude (via the MCP server, Claude Code, scripts or file import).
 *
 * Design rules
 *  - Every event carries a client-chosen `eventId` → idempotent processing (same id + same payload = no-op).
 *  - Entities are addressed by a stable, client-chosen `externalId` → repeated upserts never create duplicates.
 *  - Similar names NEVER merge automatically; ambiguous matches become reviewable conflicts.
 */
import { z } from 'zod';
import { EFFORTS, LIFECYCLE_STATUSES, NODE_NATURES } from './domain';

export const INGEST_SCHEMA_ID = 'omega.ingest/v1';

export const externalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/, 'externalId: nur Buchstaben, Ziffern und . _ : / @ - (stabil, z. B. "omega-infinity/code-explorer")');

const shortText = (max: number) => z.string().trim().max(max);
const lifecycle = z.enum(LIFECYCLE_STATUSES);
const slugish = z.string().trim().min(1).max(80);
const repoFullName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'repository: Format "owner/name"');

export const projectUpsertData = z.object({
  externalId: externalIdSchema,
  name: shortText(200).min(1),
  kind: z.enum(['project', 'subproject']).default('project'),
  parentExternalId: externalIdSchema.optional(),
  summary: shortText(400).optional(),
  description: shortText(20000).optional(),
  status: lifecycle.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  category: slugish.optional(),
  repository: repoFullName.optional(),
  tags: z.array(shortText(40).min(1)).max(20).optional(),
});

export const nodeUpsertData = z.object({
  externalId: externalIdSchema,
  name: shortText(200).min(1),
  kind: z.enum(['subproject', 'module', 'submodule', 'feature', 'component']),
  parentExternalId: externalIdSchema,
  summary: shortText(400).optional(),
  description: shortText(20000).optional(),
  status: lifecycle.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  nature: z.enum(NODE_NATURES).optional(),
  codePath: shortText(500).optional(),
  category: slugish.optional(),
  tags: z.array(shortText(40).min(1)).max(20).optional(),
});

export const ideaUpsertData = z.object({
  externalId: externalIdSchema,
  title: shortText(200).min(1),
  summary: shortText(400).min(1),
  description: shortText(8000).optional(),
  problem: shortText(2000).optional(),
  goal: shortText(2000).optional(),
  benefit: shortText(2000).optional(),
  audience: shortText(400).optional(),
  category: slugish.optional(),
  features: z.array(shortText(300)).max(20).optional(),
  technologies: z.array(shortText(80)).max(20).optional(),
  complexity: z.number().int().min(1).max(5).optional(),
  effort: z.enum(EFFORTS).optional(),
  tags: z.array(shortText(40).min(1)).max(20).optional(),
});

export const progressReportData = z.object({
  externalId: externalIdSchema,
  summary: shortText(2000).min(1),
  status: lifecycle.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  details: shortText(20000).optional(),
});

export const docUpsertData = z.object({
  externalId: externalIdSchema,
  parentExternalId: externalIdSchema,
  title: shortText(200).min(1),
  body: z.string().max(200_000),
});

export const nodeRenameData = z.object({ externalId: externalIdSchema, name: shortText(200).min(1) });
export const nodeArchiveData = z.object({ externalId: externalIdSchema, reason: shortText(1000).optional() });

const base = {
  eventId: z.string().trim().min(1).max(200),
  occurredAt: z.string().datetime({ offset: true }).optional(),
};

export const ingestEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('project.upsert'), data: projectUpsertData }),
  z.object({ ...base, type: z.literal('node.upsert'), data: nodeUpsertData }),
  z.object({ ...base, type: z.literal('idea.upsert'), data: ideaUpsertData }),
  z.object({ ...base, type: z.literal('progress.report'), data: progressReportData }),
  z.object({ ...base, type: z.literal('doc.upsert'), data: docUpsertData }),
  z.object({ ...base, type: z.literal('node.rename'), data: nodeRenameData }),
  z.object({ ...base, type: z.literal('node.archive'), data: nodeArchiveData }),
]);
export type IngestEvent = z.infer<typeof ingestEventSchema>;
export type IngestEventType = IngestEvent['type'];

export const ingestEnvelopeSchema = z.object({
  schema: z.literal(INGEST_SCHEMA_ID),
  source: z
    .object({
      client: shortText(60).min(1).default('unknown'),
      label: shortText(120).optional(),
    })
    .optional(),
  events: z.array(z.unknown()).min(1).max(100),
});
export type IngestEnvelope = z.infer<typeof ingestEnvelopeSchema>;

export type IngestResultStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected' | 'failed';
export interface IngestEventResult {
  eventId: string;
  type?: string;
  status: IngestResultStatus;
  message: string;
  entityType?: 'node' | 'idea';
  entityId?: string;
  conflictId?: string;
  issues?: { path: string; message: string }[];
}
export interface IngestResponse {
  schema: typeof INGEST_SCHEMA_ID;
  runId: string;
  summary: Record<IngestResultStatus, number>;
  results: IngestEventResult[];
}

/** Example payload, used by docs, the settings page and tests. */
export const INGEST_EXAMPLE = {
  schema: INGEST_SCHEMA_ID,
  source: { client: 'claude-code', label: 'Claude Code – OMEGA Repo' },
  events: [
    {
      eventId: 'omega-2026-11-06-001',
      type: 'project.upsert',
      data: {
        externalId: 'omega-infinity',
        name: 'OMEGA Infinity',
        summary: 'Persönliches digitales Betriebssystem',
        status: 'in_development',
        category: 'web-apps',
        repository: 'owner/repo',
      },
    },
    {
      eventId: 'omega-2026-11-06-002',
      type: 'node.upsert',
      data: {
        externalId: 'omega-infinity/code-explorer',
        parentExternalId: 'omega-infinity',
        kind: 'module',
        name: 'Code Explorer',
        nature: 'technical',
        codePath: 'web/src/features/code-explorer',
        status: 'in_development',
      },
    },
    {
      eventId: 'omega-2026-11-06-003',
      type: 'progress.report',
      data: { externalId: 'omega-infinity', summary: 'Backup-System implementiert und getestet.', progress: 60 },
    },
  ],
} as const;
