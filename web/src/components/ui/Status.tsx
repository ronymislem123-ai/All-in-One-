import { CircleCheck, CircleDashed, FlaskConical, GitBranch, ShieldCheck, Sparkles, CircleX, Clock } from 'lucide-react';
import {
  APP_AVAILABILITY_LABELS, CODE_STATUS_LABELS, LIFECYCLE_LABELS, VERIFICATION_LABELS, ORIGIN_LABELS, REVIEW_STATE_LABELS,
  type AppAvailability, type CodeStatus, type Health, type LifecycleStatus, type VerificationStatus, type Origin, type ReviewState,
} from '@shared/domain';

const LIFECYCLE_TONE: Record<LifecycleStatus, string> = {
  idea: 'unknown', planned: 'outline', concept: 'accent', in_development: 'ion', claude_reported_done: 'accent', released: 'ok', unknown: 'unknown', unavailable: 'crit',
};
export function LifecycleBadge({ status }: { status: string }) {
  const s = status as LifecycleStatus;
  return <span className={`badge ${LIFECYCLE_TONE[s] ?? 'unknown'}`} title="Konzept-/Lebenszyklus-Status">{s === 'claude_reported_done' && <Sparkles />}{LIFECYCLE_LABELS[s] ?? status}</span>;
}

const CODE_TONE: Record<CodeStatus, string> = { not_linked: 'unknown', detected: 'ok', missing: 'warn', unreachable: 'crit', pending: 'unknown' };
export function CodeBadge({ status, detail }: { status: string; detail?: string }) {
  const s = status as CodeStatus;
  const Ico = s === 'detected' ? GitBranch : s === 'unreachable' ? CircleX : s === 'pending' ? Clock : CircleDashed;
  return <span className={`badge ${CODE_TONE[s] ?? 'unknown'}`} title={`Code-Status (aus GitHub abgeleitet)${detail ? ': ' + detail : ''}`}><Ico />{CODE_STATUS_LABELS[s] ?? status}</span>;
}

export function VerificationBadge({ status }: { status: string }) {
  const s = status as VerificationStatus;
  const tone = s === 'functionally_tested' ? 'ok' : s === 'technically_verified' ? 'ion' : 'unknown';
  const Ico = s === 'functionally_tested' ? CircleCheck : s === 'technically_verified' ? ShieldCheck : FlaskConical;
  return <span className={`badge ${tone}`} title="Prüfstatus (von dir mit Nachweis gesetzt)"><Ico />{VERIFICATION_LABELS[s] ?? status}</span>;
}

/** The three independent status axes side by side – never merged into one value (§9.5). */
export function StatusPipeline({ lifecycle, code, codeDetail, verification }: { lifecycle: string; code?: string; codeDetail?: string; verification: string }) {
  return (
    <div className="pipeline" aria-label="Statusachsen">
      <LifecycleBadge status={lifecycle} />
      {code && <CodeBadge status={code} detail={codeDetail} />}
      <VerificationBadge status={verification} />
    </div>
  );
}

export function AvailabilityBadge({ status }: { status: string }) {
  const s = status as AppAvailability;
  const tone = s === 'available' ? 'ok' : s === 'manual_confirmed' ? 'ion' : s === 'unreachable' ? 'crit' : 'unknown';
  return <span className={`badge ${tone}`}>{APP_AVAILABILITY_LABELS[s] ?? status}</span>;
}

export const HEALTH_LABELS: Record<Health, string> = { ok: 'Erfolgreich', attention: 'Aufmerksamkeit erforderlich', critical: 'Kritischer Fehler', unknown: 'Nicht eingerichtet / unbekannt' };
export function HealthDot({ health, pulse }: { health: Health; pulse?: boolean }) {
  return <span className={`dot ${health} ${pulse ? 'pulse' : ''}`} role="img" aria-label={HEALTH_LABELS[health]} title={HEALTH_LABELS[health]} />;
}

export function OriginBadge({ origin }: { origin: string }) {
  return <span className={`badge outline`} title="Herkunft">{ORIGIN_LABELS[origin as Origin] ?? origin}</span>;
}

export function ReviewBadge({ state }: { state: string }) {
  if (state === 'ok') return null;
  return <span className="badge warn">{REVIEW_STATE_LABELS[state as ReviewState] ?? state}</span>;
}
