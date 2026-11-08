/**
 * omega.live/v1 – the exchange format for the "Werkstatt" (live development view).
 *
 * Claude streams what it is doing right now – research, plans, decisions, code, tests, problems,
 * milestones, tasks, screenshots and the preview address – into OMEGA. OMEGA only displays it;
 * nothing here changes project data (see ADR-014). Events are idempotent through `eventId`.
 */
import { z } from 'zod';
import { externalIdSchema } from './ingest';

export const LIVE_SCHEMA_ID = 'omega.live/v1';

export const LIVE_STATES = ['planning', 'building', 'testing', 'done', 'paused'] as const;
export type LiveState = (typeof LIVE_STATES)[number];
export const LIVE_STATE_LABELS: Record<LiveState, string> = {
  planning: 'Planung',
  building: 'Entwicklung',
  testing: 'Test',
  done: 'Abgeschlossen',
  paused: 'Pausiert',
};

export const LIVE_EVENT_KINDS = ['log', 'research', 'plan', 'decision', 'build', 'test', 'problem', 'milestone', 'task', 'screenshot', 'preview', 'status'] as const;
export type LiveEventKind = (typeof LIVE_EVENT_KINDS)[number];
export const LIVE_EVENT_KIND_LABELS: Record<LiveEventKind, string> = {
  log: 'Notiz',
  research: 'Recherche',
  plan: 'Planung',
  decision: 'Entscheidung',
  build: 'Code',
  test: 'Test',
  problem: 'Problem',
  milestone: 'Meilenstein',
  task: 'Aufgabe',
  screenshot: 'Screenshot',
  preview: 'Vorschau',
  status: 'Status',
};

export const MILESTONE_STATUSES = ['pending', 'active', 'done'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
export const TASK_STATUSES = ['todo', 'doing', 'done', 'blocked'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { todo: 'Offen', doing: 'In Arbeit', done: 'Erledigt', blocked: 'Blockiert' };

export const LIVE_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'] as const;
/** Raw bytes per image – the HTTP body limit (4 MB) bounds the base64 envelope anyway. */
export const LIVE_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

const text = (max: number) => z.string().trim().max(max);
const key = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'key: nur Buchstaben, Ziffern und . _ : -');
const percent = z.number().min(0).max(100);
/** Preview addresses are opened by the owner in a new tab – only http(s). */
const previewUrl = z.string().trim().max(2000).url().refine((u) => /^https?:\/\//i.test(u), 'previewUrl: nur http(s)');

export const liveMilestoneData = z.object({
  key,
  label: text(120).min(1).optional(),
  order: z.number().int().min(0).max(1000).optional(),
  progress: percent.optional(),
  status: z.enum(MILESTONE_STATUSES).optional(),
});
export type LiveMilestoneInput = z.infer<typeof liveMilestoneData>;

export const liveTaskData = z.object({
  key,
  title: text(200).min(1).optional(),
  detail: text(1000).optional(),
  order: z.number().int().min(0).max(10000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
});
export type LiveTaskInput = z.infer<typeof liveTaskData>;

export const liveImageData = z.object({
  mime: z.enum(LIVE_IMAGE_MIMES),
  /** Base64 (without data: prefix). */
  base64: z.string().min(1).max(Math.ceil((LIVE_IMAGE_MAX_BYTES * 4) / 3) + 4),
  caption: text(500).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const liveSessionUpsertData = z.object({
  externalId: externalIdSchema,
  title: text(200).min(1),
  goal: text(4000).optional(),
  state: z.enum(LIVE_STATES).optional(),
  phase: text(120).optional(),
  /** Overall progress. Omit to let OMEGA derive it from the milestones. */
  progress: percent.nullable().optional(),
  previewUrl: previewUrl.nullable().optional(),
  previewNote: text(300).nullable().optional(),
  /** Current activity in one sentence ("Gerade in Arbeit"). */
  now: text(300).nullable().optional(),
  /** externalId of the OMEGA project this session belongs to (optional, resolved if known). */
  projectExternalId: externalIdSchema.optional(),
  milestones: z.array(liveMilestoneData.extend({ label: text(120).min(1) })).max(30).optional(),
  tasks: z.array(liveTaskData.extend({ title: text(200).min(1) })).max(200).optional(),
});
export type LiveSessionUpsertInput = z.infer<typeof liveSessionUpsertData>;

export const liveEventData = z
  .object({
    eventId: z.string().trim().min(1).max(160).optional(),
    at: z.string().datetime({ offset: true }).optional(),
    kind: z.enum(LIVE_EVENT_KINDS),
    title: text(200).min(1),
    body: text(20000).optional(),
    milestone: liveMilestoneData.optional(),
    task: liveTaskData.optional(),
    preview: z.object({ url: previewUrl.nullable(), note: text(300).optional() }).optional(),
    status: z.object({ state: z.enum(LIVE_STATES).optional(), phase: text(120).optional(), progress: percent.nullable().optional(), now: text(300).nullable().optional() }).optional(),
    image: liveImageData.optional(),
  })
  .superRefine((e, ctx) => {
    if (e.kind === 'milestone' && !e.milestone) ctx.addIssue({ code: 'custom', path: ['milestone'], message: 'Ereignis „milestone“ benötigt das Feld milestone.' });
    if (e.kind === 'task' && !e.task) ctx.addIssue({ code: 'custom', path: ['task'], message: 'Ereignis „task“ benötigt das Feld task.' });
    if (e.kind === 'screenshot' && !e.image) ctx.addIssue({ code: 'custom', path: ['image'], message: 'Ereignis „screenshot“ benötigt das Feld image.' });
    if (e.kind === 'preview' && !e.preview) ctx.addIssue({ code: 'custom', path: ['preview'], message: 'Ereignis „preview“ benötigt das Feld preview.' });
    if (e.kind === 'status' && !e.status) ctx.addIssue({ code: 'custom', path: ['status'], message: 'Ereignis „status“ benötigt das Feld status.' });
  });
export type LiveEventInput = z.infer<typeof liveEventData>;

export const liveEventsEnvelope = z.object({
  schema: z.literal(LIVE_SCHEMA_ID).optional(),
  events: z.array(z.unknown()).min(1).max(100),
});

export interface LiveEventResult {
  index: number;
  eventId: string | null;
  status: 'applied' | 'duplicate' | 'rejected';
  message: string;
  issues?: { path: string; message: string }[];
  id?: number;
}
