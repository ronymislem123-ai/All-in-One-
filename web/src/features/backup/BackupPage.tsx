import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, CircleCheck, Download, HardDriveDownload, Lock, LockOpen, RotateCcw, ShieldCheck, Trash2, CloudUpload, History, Boxes } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { BackupMeta, BackupStatus } from '../../api/types';
import { bytes, dateTime, relTime } from '../../lib/format';
import { Button, Callout, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Skeleton, Tabs, useToast } from '../../components/ui';
import { HEALTH_LABELS, HealthDot } from '../../components/ui/Status';
import { PageHeader } from '../../components/layout/PageHeader';

const KIND: Record<string, string> = { snapshot: 'Zwischenstand', manual: 'Manuell', pre_restore: 'Vor Wiederherstellung', pre_migration: 'Vor Migration', pre_import: 'Vor Import' };

function Backups() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ status: BackupStatus; backups: BackupMeta[]; restores: { id: string; at: string; type: string; backup: string; preRestoreBackup: string | null; ok: boolean; detail: string }[] }>('/api/backups'), refetchInterval: 30_000 });
  const [note, setNote] = useState('');
  const [restore, setRestore] = useState<BackupMeta | null>(null);
  const [projectRestore, setProjectRestore] = useState<BackupMeta | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const projects = useQuery({ queryKey: ['backup', projectRestore?.name, 'projects'], queryFn: () => api.get<{ id: string; name: string; descendants: number; updated_at: string; deleted_at: string | null }[]>(`/api/backups/${projectRestore!.name}/projects`), enabled: Boolean(projectRestore) });
  const create = useMutation({ mutationFn: () => api.post<BackupMeta>('/api/backups', { note: note || undefined }), onSuccess: (m) => { qc.invalidateQueries({ queryKey: ['backups'] }); setNote(''); toast({ kind: 'success', title: 'Sicherung erstellt und verifiziert', body: `${m.name} · ${bytes(m.size)}` }); }, onError: (e: ApiError) => toast({ kind: 'error', title: 'Sicherung fehlgeschlagen', body: e.message }) });
  const verify = useMutation({ mutationFn: (n: string) => api.post<BackupMeta>(`/api/backups/${n}/verify`), onSuccess: (m) => { qc.invalidateQueries({ queryKey: ['backups'] }); toast({ kind: m.verified?.ok ? 'success' : 'error', title: m.verified?.ok ? 'Sicherung ist intakt' : 'Sicherung fehlerhaft', body: m.verified?.detail }); } });
  const doRestore = useMutation({
    mutationFn: (n: string) => api.post<{ ok: boolean; detail: string; preRestoreBackup: string }>(`/api/backups/${n}/restore`, { confirm: 'WIEDERHERSTELLEN' }),
    onSuccess: (r) => { qc.invalidateQueries(); setRestore(null); toast({ kind: 'success', title: 'Wiederherstellung abgeschlossen', body: `${r.detail}. Vorheriger Stand: ${r.preRestoreBackup}` }); },
    onError: (e: ApiError) => toast({ kind: 'error', title: 'Wiederherstellung fehlgeschlagen', body: e.message }),
  });
  const doProject = useMutation({
    mutationFn: () => api.post<{ ok: boolean; detail: string; preRestoreBackup: string }>(`/api/backups/${projectRestore!.name}/restore-project`, { nodeId: projectId, confirm: 'WIEDERHERSTELLEN' }),
    onSuccess: (r) => { qc.invalidateQueries(); setProjectRestore(null); setProjectId(null); toast({ kind: 'success', title: 'Projekt wiederhergestellt', body: `${r.detail}. Vorher gesichert als ${r.preRestoreBackup}` }); },
    onError: (e: ApiError) => toast({ kind: 'error', title: 'Nicht möglich', body: e.message }),
  });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Skeleton h={400} r={16} />;
  const s = q.data.status;
  return (
    <div className="stack">
      <div className="grid-3">
        <Card title="Status" icon={<ShieldCheck />}>
          <div className="status-line"><HealthDot health={s.health} pulse={s.health === 'critical'} /><div><strong>{HEALTH_LABELS[s.health]}</strong><p className="subtle xsmall">{s.last ? `Letzte Sicherung ${relTime(s.last.createdAt)}` : 'Noch keine Sicherung'}{s.changedSinceLastBackup ? ' · Änderungen seitdem' : ' · keine neuen Änderungen'}</p></div></div>
          {s.lastError && <p className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>Letzter Fehler: {s.lastError}</p>}
        </Card>
        <Card title="Zeitplan" icon={<History />}>
          <dl className="kv"><dt>Intervall</dt><dd>alle {s.intervalMinutes} Min. (nur bei Änderungen)</dd><dt>Nächste Prüfung</dt><dd>{s.nextScheduledAt ? relTime(s.nextScheduledAt) : 'nach Serverstart'}</dd><dt>Ereignisbasiert</dt><dd>jede Änderung sofort dauerhaft gespeichert + versioniert</dd></dl>
        </Card>
        <Card title="Schutz" icon={s.encryption ? <Lock /> : <LockOpen />}>
          <dl className="kv"><dt>Verschlüsselung</dt><dd>{s.encryption ? <span className="badge ok">AES-256-GCM</span> : <span className="badge warn">aus</span>}</dd><dt>Externe Kopie</dt><dd>{s.external.configured ? <span className="badge ok">aktiv ({s.external.dir})</span> : <span className="badge warn">nicht eingerichtet</span>}</dd><dt>Speicher</dt><dd>{s.count} Punkte · {bytes(s.totalBytes)}</dd></dl>
        </Card>
      </div>
      {(!s.encryption || !s.external.configured) && (
        <Callout kind="warn" title="Empfehlung">
          {!s.encryption && <div>Setze <code>OMEGA_BACKUP_PASSPHRASE</code>, damit Sicherungen verschlüsselt werden.</div>}
          {!s.external.configured && <div>Setze <code>OMEGA_BACKUP_EXTERNAL_DIR</code> auf ein unabhängiges Laufwerk (z. B. eingebundener Cloud-Speicher). Eine Sicherung nur neben der Datenbank schützt nicht vor dem Ausfall dieses Datenträgers.</div>}
        </Callout>
      )}
      <Callout title="Grenze der Sicherung">OMEGA sichert nur, was ihm übermittelt wurde oder worauf es zugreifen kann. Nicht übermittelte Claude-Unterhaltungen sind nicht Teil dieser Backups.</Callout>
      <Card title="Sicherung erstellen" icon={<HardDriveDownload />}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <input className="input" style={{ flex: '1 1 260px' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz (optional), z. B. „Vor großem Umbau“" aria-label="Notiz zur Sicherung" />
          <Button type="submit" variant="primary" loading={create.isPending}><HardDriveDownload /> Jetzt sichern</Button>
        </form>
      </Card>
      <Card title="Wiederherstellungspunkte" icon={<History />}>
        {q.data.backups.length === 0 ? <EmptyState icon={<HardDriveDownload />} title="Noch keine Sicherung" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Zeitpunkt</th><th>Art</th><th>Inhalt</th><th>Größe</th><th>Prüfung</th><th>Extern</th><th /></tr></thead>
            <tbody>{q.data.backups.map((b) => (
              <tr key={b.name}>
                <td title={b.name}>{dateTime(b.createdAt)}<div className="subtle xsmall">{b.note}</div></td>
                <td><span className="badge outline">{KIND[b.kind] ?? b.kind}</span>{b.encrypted && <Lock size={12} style={{ marginLeft: 6 }} aria-label="verschlüsselt" />}</td>
                <td className="xsmall">{b.counts.projects ?? '–'} Projekte · {b.counts.nodes ?? '–'} Objekte · {b.counts.ideas ?? '–'} Ideen</td>
                <td>{bytes(b.size)}</td>
                <td>{b.verified ? <span className={`badge ${b.verified.ok ? 'ok' : 'crit'}`} title={b.verified.detail}>{b.verified.ok ? <CircleCheck /> : null}{b.verified.ok ? 'intakt' : 'fehlerhaft'}</span> : '–'}</td>
                <td>{b.external ? (b.external.copied ? <span className="badge ok"><CloudUpload />kopiert</span> : <span className="badge crit" title={b.external.error ?? ''}>Fehler</span>) : '–'}</td>
                <td><div className="row" style={{ flexWrap: 'nowrap' }}>
                  <Button size="sm" variant="ghost" onClick={() => verify.mutate(b.name)}>Prüfen</Button>
                  <Button size="sm" variant="ghost" onClick={() => setProjectRestore(b)}><Boxes /> Projekt</Button>
                  <Button size="sm" onClick={() => setRestore(b)}><RotateCcw /> Alles</Button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {q.data.restores.length > 0 && (
        <Card title="Wiederherstellungsprotokoll" icon={<ArchiveRestore />}>
          <div className="list">{q.data.restores.map((r) => <div key={r.id} className="list-item"><span className={`dot ${r.ok ? 'ok' : 'critical'}`} /><span className="small" style={{ flex: 1 }}>{r.type === 'full' ? 'Vollständig' : 'Projekt'} aus {r.backup}: {r.detail}{r.preRestoreBackup && <span className="subtle"> · vorher gesichert: {r.preRestoreBackup}</span>}</span><span className="meta">{relTime(r.at)}</span></div>)}</div>
        </Card>
      )}
      <ConfirmDialog open={Boolean(restore)} onClose={() => setRestore(null)} onConfirm={() => restore && doRestore.mutate(restore.name)} loading={doRestore.isPending} danger requireText="WIEDERHERSTELLEN" confirmLabel="Vollständig wiederherstellen" title="Gesamten Datenstand wiederherstellen?">
        <p>Alle Verwaltungsdaten werden auf den Stand vom <strong>{dateTime(restore?.createdAt)}</strong> zurückgesetzt. Vorher wird automatisch eine Sicherung des aktuellen Stands erstellt – du kannst jederzeit zurück.</p>
        <p className="subtle small">Konten, Sitzungen, API-Tokens und Einstellungen bleiben erhalten. GitHub und Claude werden nicht verändert.</p>
      </ConfirmDialog>
      <Dialog open={Boolean(projectRestore)} onClose={() => { setProjectRestore(null); setProjectId(null); }} title="Einzelnes Projekt wiederherstellen" description={`Aus der Sicherung vom ${dateTime(projectRestore?.createdAt)}. Andere Projekte bleiben unverändert.`}
        footer={<><Button onClick={() => setProjectRestore(null)}>Abbrechen</Button><Button variant="primary" disabled={!projectId} loading={doProject.isPending} onClick={() => doProject.mutate()}>Projekt wiederherstellen</Button></>}>
        {!projects.data ? <Skeleton h={120} /> : projects.data.length === 0 ? <p className="subtle small">Keine Projekte in dieser Sicherung.</p> : (
          <div className="list" style={{ maxHeight: 340, overflowY: 'auto' }}>
            {projects.data.map((p) => (
              <label key={p.id} className="list-item" style={{ cursor: 'pointer' }}>
                <input type="radio" name="proj" checked={projectId === p.id} onChange={() => setProjectId(p.id)} />
                <span style={{ flex: 1 }}>{p.name}<span className="subtle xsmall" style={{ display: 'block' }}>{p.descendants} Unterobjekte · Stand {relTime(p.updated_at)}{p.deleted_at ? ' · war im Papierkorb' : ''}</span></span>
              </label>
            ))}
          </div>
        )}
        <div style={{ marginTop: 12 }}><Callout>Vorher wird automatisch eine Sicherung erstellt.</Callout></div>
      </Dialog>
    </div>
  );
}

function Trash() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['trash'], queryFn: () => api.get<{ nodes: { id: string; name: string; kind: string; deleted_at: string }[]; ideas: { id: string; name: string; deleted_at: string }[]; apps: { id: string; name: string; deleted_at: string }[] }>('/api/trash') });
  const [purge, setPurge] = useState<{ type: string; id: string; name: string } | null>(null);
  const restore = useMutation({ mutationFn: (x: { type: string; id: string }) => api.post(`/api/trash/${x.type}/${x.id}/restore`), onSuccess: () => { qc.invalidateQueries(); toast({ kind: 'success', title: 'Wiederhergestellt' }); } });
  const doPurge = useMutation({ mutationFn: () => api.del(`/api/trash/${purge!.type}/${purge!.id}`, { confirm: 'ENDGÜLTIG' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['trash'] }); setPurge(null); toast({ kind: 'success', title: 'Endgültig gelöscht' }); }, onError: (e: ApiError) => toast({ kind: 'error', title: 'Nicht möglich', body: e.message }) });
  if (!q.data) return <Skeleton h={200} />;
  const all = [...q.data.nodes.map((n) => ({ ...n, type: 'node', label: 'Projekt/Modul' })), ...q.data.ideas.map((n) => ({ ...n, type: 'idea', label: 'Idee' })), ...q.data.apps.map((n) => ({ ...n, type: 'application', label: 'App' }))].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  if (!all.length) return <EmptyState icon={<Trash2 />} title="Papierkorb ist leer" />;
  return (
    <Card title="Papierkorb" icon={<Trash2 />}>
      <p className="subtle small" style={{ marginBottom: 10 }}>Gelöschte Einträge bleiben hier, bis du sie endgültig entfernst. Endgültiges Löschen erfordert eine ausdrückliche Bestätigung.</p>
      <div className="list">{all.map((x) => (
        <div key={`${x.type}:${x.id}`} className="list-item">
          <span className="badge outline">{x.label}</span><span className="small" style={{ flex: 1 }}>{x.name}</span><span className="meta">{relTime(x.deleted_at)}</span>
          <Button size="sm" onClick={() => restore.mutate(x)}><ArchiveRestore /> Wiederherstellen</Button>
          <Button size="sm" variant="ghost" onClick={() => setPurge({ type: x.type, id: x.id, name: x.name })} aria-label={`${x.name} endgültig löschen`}><Trash2 /></Button>
        </div>
      ))}</div>
      <ConfirmDialog open={Boolean(purge)} onClose={() => setPurge(null)} onConfirm={() => doPurge.mutate()} danger requireText="ENDGÜLTIG" confirmLabel="Endgültig löschen" loading={doPurge.isPending} title={`„${purge?.name}“ endgültig löschen?`}>
        Danach nur noch über eine Datensicherung wiederherstellbar. Die Versionshistorie bleibt erhalten.
      </ConfirmDialog>
    </Card>
  );
}

function Transfer() {
  const toast = useToast();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const imp = useMutation({
    mutationFn: async () => api.post<{ backup: string; report: Record<string, { inserted: number; existing: number; invalid: number }> }>('/api/import/export', JSON.parse(await file!.text())),
    onSuccess: (r) => { qc.invalidateQueries(); toast({ kind: 'success', title: 'Import abgeschlossen', body: `Vorher gesichert: ${r.backup}. Neu: ${Object.values(r.report).reduce((s, x) => s + x.inserted, 0)} Datensätze, vorhanden (unverändert): ${Object.values(r.report).reduce((s, x) => s + x.existing, 0)}` }); },
    onError: (e: Error) => toast({ kind: 'error', title: 'Import fehlgeschlagen', body: e.message }),
  });
  return (
    <div className="grid-2">
      <Card title="Export" icon={<Download />}>
        <p className="muted small" style={{ marginBottom: 12 }}>Alle Verwaltungsdaten als JSON (Projekte, Module, Apps, Ideen, Kategorien, Verknüpfungen). Enthält keine Passwörter, Sitzungen, Tokens oder Geheimnisse.</p>
        <div className="row"><a className="btn primary" href="/api/export" download><Download /> Exportieren</a><a className="btn" href="/api/export?activity=1" download>Mit Chronik</a></div>
      </Card>
      <Card title="Export importieren" icon={<ArchiveRestore />}>
        <p className="muted small" style={{ marginBottom: 12 }}>Führt eine OMEGA-Exportdatei mit deinen Daten zusammen. Bestehende Einträge werden nie überschrieben oder gelöscht; vorher wird automatisch gesichert.</p>
        <Field label="Exportdatei (.json)">{(id) => <input id={id} type="file" accept=".json,application/json" className="input" style={{ paddingTop: 6 }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
        <Button variant="primary" style={{ marginTop: 12 }} disabled={!file} loading={imp.isPending} onClick={() => imp.mutate()}>Importieren</Button>
      </Card>
    </div>
  );
}

export default function BackupPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'backups' | 'trash' | 'transfer') ?? 'backups';
  return (
    <div>
      <PageHeader eyebrow={<><ShieldCheck size={14} /> Backup & Sicherheit</>} title="Datensicherung & Wiederherstellung" lead="Ereignisbasiertes Speichern, versionierte Änderungen, verifizierte 15-Minuten-Zwischenstände und kontrollierte Wiederherstellung." />
      <Tabs label="Bereiche" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={[{ id: 'backups', label: 'Sicherungen', icon: <HardDriveDownload /> }, { id: 'trash', label: 'Papierkorb', icon: <Trash2 /> }, { id: 'transfer', label: 'Import & Export', icon: <Download /> }]} />
      {tab === 'backups' && <Backups />}
      {tab === 'trash' && <Trash />}
      {tab === 'transfer' && <Transfer />}
    </div>
  );
}
