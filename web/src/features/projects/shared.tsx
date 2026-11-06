import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Box, Component, FileText, Link2, Puzzle, StickyNote, Layers, Search } from 'lucide-react';
import { api, ApiError, qs } from '../../api/client';
import type { Category, NodeDetail, NodeDto, NodeListItem } from '../../api/types';
import { Button, Dialog, Field, useToast } from '../../components/ui';
import { ICON_NAMES, Icon } from '../../components/ui/Icon';
import { LIFECYCLE_LABELS, LIFECYCLE_STATUSES, NODE_KIND_LABELS, NODE_KINDS, PRIORITY_LABELS, VERIFICATION_LABELS, VERIFICATION_STATUSES, type NodeKind } from '@shared/domain';

export const KIND_ICONS: Record<string, typeof Boxes> = {
  project: Boxes, subproject: Layers, module: Box, submodule: Box, feature: Puzzle, component: Component, documentation: FileText, reference: Link2, note: StickyNote,
};
export function KindIcon({ kind }: { kind: string }) {
  const I = KIND_ICONS[kind] ?? Box;
  return <span className="kind-icon" title={NODE_KIND_LABELS[kind as NodeKind]}><I aria-hidden /></span>;
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/api/categories'), staleTime: 5 * 60_000 });
}

export function CategorySelect({ id, value, onChange, allowEmpty = true, label = 'Keine Kategorie' }: { id?: string; value: string | null | undefined; onChange: (v: string | null) => void; allowEmpty?: boolean; label?: string }) {
  const cats = useCategories();
  return (
    <select id={id} aria-label={id ? undefined : 'Kategorie'} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{label}</option>}
      {cats.data?.map((c) => (
        <optgroup key={c.id} label={c.name}>
          <option value={c.id}>{c.name}</option>
          {c.children.map((s) => <option key={s.id} value={s.id}>— {s.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

type FormState = {
  kind: string; name: string; summary: string; description: string; body: string; categoryId: string | null; lifecycleStatus: string; priority: number;
  progress: string; nature: string; codePath: string; notes: string; tags: string; icon: string; color: string; url: string; claudeProjectUrl: string;
  verificationStatus: string; verificationNote: string;
};
const fromNode = (n?: NodeDto | null, tags: string[] = []): FormState => ({
  kind: n?.kind ?? 'project', name: n?.name ?? '', summary: n?.summary ?? '', description: n?.description ?? '', body: n?.body ?? '',
  categoryId: n?.categoryId ?? null, lifecycleStatus: n?.lifecycleStatus ?? 'planned', priority: n?.priority ?? 2,
  progress: n?.progress != null ? String(n.progress) : '', nature: n?.nature ?? 'organizational', codePath: n?.codePath ?? '', notes: n?.notes ?? '',
  tags: tags.join(', '), icon: n?.icon ?? '', color: n?.color ?? '', url: n?.url ?? '', claudeProjectUrl: n?.claudeProjectUrl ?? '',
  verificationStatus: n?.verificationStatus ?? 'unverified', verificationNote: n?.verificationNote ?? '',
});

/** Create or edit a node. Fields owned by Claude are marked so the owner knows what a future sync may update. */
export function NodeFormDialog({ open, onClose, node, tags, parentId, defaultKind, onSaved }: {
  open: boolean; onClose: () => void; node?: NodeDto | null; tags?: string[]; parentId?: string | null; defaultKind?: string; onSaved?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<FormState>(fromNode(node, tags));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setF({ ...fromNode(node, tags), ...(node ? {} : { kind: defaultKind ?? (parentId ? 'module' : 'project') }) }); setErr(null); } }, [open, node, tags, parentId, defaultKind]);
  const set = <K extends keyof FormState>(k: K) => (v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: f.name.trim(), summary: f.summary.trim() || null, description: f.description || null, categoryId: f.categoryId, lifecycleStatus: f.lifecycleStatus,
        priority: Number(f.priority), progress: f.progress === '' ? null : Math.max(0, Math.min(100, Number(f.progress))), nature: f.nature,
        codePath: f.codePath.trim() || null, notes: f.notes || null, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), icon: f.icon || null,
        color: f.color || null, url: f.url.trim() || null, claudeProjectUrl: f.claudeProjectUrl.trim() || null,
        ...(f.kind === 'documentation' ? { body: f.body } : {}),
      };
      if (node) {
        return api.patch<NodeDetail>(`/api/nodes/${node.id}`, { ...payload, version: node.version, verificationStatus: f.verificationStatus, verificationNote: f.verificationNote || null });
      }
      return api.post<NodeDetail>('/api/nodes', { ...payload, kind: f.kind, parentId: parentId ?? null });
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
      qc.invalidateQueries({ queryKey: ['node'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast({ kind: 'success', title: node ? 'Gespeichert' : 'Angelegt', body: d.node.name });
      onClose();
      onSaved?.(d.node.id); // after onClose: closing may rewrite the URL (search params)
    },
    onError: (e: ApiError) => setErr(e.status === 409 ? e.message : `${e.message}${Array.isArray(e.details) ? ': ' + (e.details as { path: string; message: string }[]).map((d) => `${d.path} ${d.message}`).join(', ') : ''}`),
  });
  const claudeOwned = (field: string) => node?.fieldSources?.[field]?.src === 'claude';
  const ClaudeHint = ({ field }: { field: string }) => (claudeOwned(field) ? <span className="badge accent" style={{ marginLeft: 6 }}>von Claude</span> : null);
  const isEdit = Boolean(node);

  return (
    <Dialog open={open} onClose={onClose} wide title={isEdit ? `„${node!.name}“ bearbeiten` : parentId ? 'Unterobjekt anlegen' : 'Neues Projekt'}
      description={isEdit ? 'Website-Daten (Notizen, Priorität, Kategorie, Struktur) gehören dir – Claude überschreibt sie nie.' : 'Stabile ID wird automatisch vergeben; der Name kann jederzeit geändert werden.'}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>{isEdit ? 'Speichern' : 'Anlegen'}</Button></>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {!isEdit && (
          <Field label="Typ">{(id) => (
            <select id={id} className="select" value={f.kind} onChange={(e) => set('kind')(e.target.value)}>
              {NODE_KINDS.filter((k) => (parentId ? k !== 'project' : ['project', 'module', 'note', 'reference'].includes(k))).map((k) => <option key={k} value={k}>{NODE_KIND_LABELS[k]}</option>)}
            </select>
          )}</Field>
        )}
        <Field label="Name" className={isEdit ? 'full' : ''}>{(id) => <input id={id} className="input" value={f.name} onChange={(e) => set('name')(e.target.value)} data-autofocus required maxLength={200} />}</Field>
        <Field label="Kurzbeschreibung" className="full">{(id) => <input id={id} className="input" value={f.summary} onChange={(e) => set('summary')(e.target.value)} maxLength={400} />}</Field>
        <div className="field full">
          <label htmlFor="nf-desc">Beschreibung (Markdown)<ClaudeHint field="description" /></label>
          <textarea id="nf-desc" className="textarea" rows={4} value={f.description} onChange={(e) => set('description')(e.target.value)} />
        </div>
        {f.kind === 'documentation' && (
          <div className="field full"><label htmlFor="nf-body">Inhalt (Markdown)<ClaudeHint field="body" /></label><textarea id="nf-body" className="textarea mono" rows={10} value={f.body} onChange={(e) => set('body')(e.target.value)} /></div>
        )}
        <Field label="Kategorie">{(id) => <CategorySelect id={id} value={f.categoryId} onChange={set('categoryId')} />}</Field>
        <div className="field">
          <label htmlFor="nf-status">Status (Konzept/Lebenszyklus)<ClaudeHint field="lifecycle_status" /></label>
          <select id="nf-status" className="select" value={f.lifecycleStatus} onChange={(e) => set('lifecycleStatus')(e.target.value)}>
            {LIFECYCLE_STATUSES.map((s) => <option key={s} value={s}>{LIFECYCLE_LABELS[s]}</option>)}
          </select>
        </div>
        <Field label="Priorität">{(id) => (
          <select id={id} className="select" value={f.priority} onChange={(e) => set('priority')(Number(e.target.value))}>
            {PRIORITY_LABELS.map((p, i) => <option key={p} value={i}>{p}</option>)}
          </select>
        )}</Field>
        <Field label="Fortschritt (%)">{(id) => <input id={id} className="input" type="number" min={0} max={100} value={f.progress} onChange={(e) => set('progress')(e.target.value)} />}</Field>
        {f.kind !== 'project' && (
          <Field label="Art" hint="Organisatorische Website-Module sind keine technischen Softwaremodule.">{(id) => (
            <select id={id} className="select" value={f.nature} onChange={(e) => set('nature')(e.target.value)}>
              <option value="organizational">Organisatorisch</option><option value="technical">Technisch (Softwaremodul)</option>
            </select>
          )}</Field>
        )}
        <Field label="Codepfad im Repository" hint="z. B. server/src/modules – OMEGA prüft, ob er in GitHub existiert.">{(id) => <input id={id} className="input mono" value={f.codePath} onChange={(e) => set('codePath')(e.target.value)} placeholder="optional" />}</Field>
        <Field label="Tags" hint="Kommagetrennt">{(id) => <input id={id} className="input" value={f.tags} onChange={(e) => set('tags')(e.target.value)} />}</Field>
        <Field label="Icon">{(id) => (
          <select id={id} className="select" value={f.icon} onChange={(e) => set('icon')(e.target.value)}>
            <option value="">Automatisch</option>{ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}</Field>
        <Field label="Farbe">{(id) => (
          <div className="row"><input id={id} type="color" value={f.color || '#8d95ff'} onChange={(e) => set('color')(e.target.value)} style={{ width: 44, height: 38, border: 0, background: 'none' }} /><Icon name={f.icon || 'orbit'} /><Button size="sm" variant="ghost" onClick={() => set('color')('')}>Automatisch</Button></div>
        )}</Field>
        <Field label="Website/Projekt-URL">{(id) => <input id={id} className="input" type="url" value={f.url} onChange={(e) => set('url')(e.target.value)} placeholder="https://…" />}</Field>
        <Field label="Claude-Projekt (Referenz)" hint="Nur ein Link – OMEGA hat keinen Zugriff auf Claude.ai-Inhalte.">{(id) => <input id={id} className="input" type="url" value={f.claudeProjectUrl} onChange={(e) => set('claudeProjectUrl')(e.target.value)} placeholder="https://claude.ai/project/…" />}</Field>
        <Field label="Persönliche Notizen" className="full" hint="Nur Website – wird nie von Claude oder GitHub überschrieben.">{(id) => <textarea id={id} className="textarea" rows={3} value={f.notes} onChange={(e) => set('notes')(e.target.value)} />}</Field>
        {isEdit && (
          <>
            <Field label="Prüfstatus" hint="Erst nach tatsächlicher Prüfung setzen.">{(id) => (
              <select id={id} className="select" value={f.verificationStatus} onChange={(e) => set('verificationStatus')(e.target.value)}>
                {VERIFICATION_STATUSES.map((s) => <option key={s} value={s}>{VERIFICATION_LABELS[s]}</option>)}
              </select>
            )}</Field>
            <Field label="Nachweis / Prüfnotiz">{(id) => <input id={id} className="input" value={f.verificationNote} onChange={(e) => set('verificationNote')(e.target.value)} placeholder="z. B. Testlauf vom …, 42 Tests grün" />}</Field>
          </>
        )}
        {err && <div className="full callout crit" role="alert">{err}</div>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Search-and-pick a node (for moving, conflict resolution, linking). */
export function NodePicker({ onPick, excludeId, placeholder = 'Projekt oder Modul suchen …' }: { onPick: (n: NodeListItem | null) => void; excludeId?: string; placeholder?: string }) {
  const [q, setQ] = useState('');
  const res = useQuery({ queryKey: ['nodes', 'picker', q], queryFn: () => api.get<{ items: NodeListItem[] }>(`/api/nodes${qs({ q, limit: 20, sort: 'name', archived: 'include' })}`) });
  return (
    <div className="stack-sm">
      <div className="input-icon"><Search /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Suche" data-autofocus /></div>
      <div className="list" style={{ maxHeight: 280, overflowY: 'auto' }}>
        {res.data?.items.filter((n) => n.id !== excludeId).map((n) => (
          <button key={n.id} className="list-item" onClick={() => onPick(n)}>
            <KindIcon kind={n.kind} /><span className="truncate">{n.name}</span><span className="meta">{n.kindLabel}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
