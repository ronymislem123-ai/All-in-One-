/** Example payload (kept free of zod so the web bundle stays small). */
export const INGEST_SCHEMA_ID_EXAMPLE = 'omega.ingest/v1';
export const INGEST_EXAMPLE = {
  schema: INGEST_SCHEMA_ID_EXAMPLE,
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
