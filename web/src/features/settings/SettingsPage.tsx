import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Copy, GitBranch, KeyRound, LayoutDashboard, Laptop, Monitor, Moon, Palette, Plus, ShieldCheck, Sparkles, Sun, Tag, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { Category, Integrations } from '../../api/types';
import { usePrefs } from '../../lib/session';
import { dateTime, relTime } from '../../lib/format';
import { Button, Callout, Card, ConfirmDialog, Field, Segmented, Skeleton, Switch, Tabs, useToast } from '../../components/ui';
import { HealthDot, HEALTH_LABELS } from '../../components/ui/Status';
import { ICON_NAMES, Icon } from '../../components/ui/Icon';
import { PageHeader } from '../../components/layout/PageHeader';
import { useCategories } from '../projects/shared';
import { INGEST_EXAMPLE } from '@shared/ingest-example';

type Tab = 'appearance' | 'integrations' | 'categories' | 'security';

function Appearance() {
  const [prefs, setPrefs] = usePrefs();
  return (
    <div className="grid-2">
      <Card title="Darstellung" icon={<Palette />}>
        <div className="stack">
          <div className="field"><span className="label">Farbschema</span><Segmented label="Farbschema" value={prefs.theme} onChange={(v) => setPrefs({ theme: v })} options={[{ value: 'system', label: 'System', icon: <Laptop /> }, { value: 'dark', label: 'Dunkel', icon: <Moon /> }, { value: 'light', label: 'Hell', icon: <Sun /> }]} /></div>
          <div className="field"><span className="label">Informationsdichte</span><Segmented label="Dichte" value={prefs.density} onChange={(v) => setPrefs({ density: v })} options={[{ value: 'comfortable', label: 'Komfortabel' }, { value: 'compact', label: 'Kompakt' }]} /></div>
          <div className="field"><span className="label">Bewegung & Animationen</span><Segmented label="Bewegung" value={prefs.motion} onChange={(v) => setPrefs({ motion: v })} options={[{ value: 'system', label: 'System' }, { value: 'reduced', label: 'Reduziert' }, { value: 'full', label: 'Voll' }]} /><span className="hint">„System“ folgt der Betriebssystem-Einstellung „Bewegung reduzieren“.</span></div>
        </div>
      </Card>
      <Card title="Dashboard & Begleiter" icon={<LayoutDashboard />}>
        <div className="stack">
          <Switch checked={prefs.robotEnabled} onChange={(v) => setPrefs({ robotEnabled: v })} label="Roboter-Begleiter OMI im Code Explorer anzeigen" />
          <div className="field"><span className="label">Standard-Erklärungsebene</span><Segmented label="Erklärungsebene" value={prefs.explainLevel} onChange={(v) => setPrefs({ explainLevel: v })} options={[{ value: 'simple', label: 'Einfach' }, { value: 'technical', label: 'Technisch' }]} /></div>
          <Button onClick={() => setPrefs({ dashboardWidgets: ['welcome', 'stats', 'attention', 'recent', 'activity', 'sync', 'backup', 'favorites', 'recommendations', 'ideas'], hiddenWidgets: [] })}>Dashboard-Layout zurücksetzen</Button>
        </div>
      </Card>
    </div>
  );
}

function Integrations() {
  const qc = useQueryClient();
  const toast = useToast();
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => api.get<{ id: string; name: string; token_hint: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null }[]>('/api/tokens') });
  const integ = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<Integrations>('/api/integrations') });
  const gh = useQuery({ queryKey: ['github', 'status'], queryFn: () => api.get<{ tokenSource: string | null; tokenInfo: { stored: boolean; hint: string | null }; envToken: boolean; webhookConfigured: boolean; webhookUrl: string | null; settings: { pollMinutes: number; autoDiscover: boolean; analyzeOnSync: boolean }; permissions: string }>('/api/github/status') });
  const [tokenName, setTokenName] = useState('Claude Code (MCP)');
  const [withRead, setWithRead] = useState(true);
  const [created, setCreated] = useState<string | null>(null);
  const [ghToken, setGhToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [revoke, setRevoke] = useState<string | null>(null);
  const create = useMutation({ mutationFn: () => api.post<{ token: string }>('/api/tokens', { name: tokenName, scopes: withRead ? ['ingest', 'read'] : ['ingest'] }), onSuccess: (r) => { setCreated(r.token); qc.invalidateQueries({ queryKey: ['tokens'] }); qc.invalidateQueries({ queryKey: ['integrations'] }); } });
  const doRevoke = useMutation({ mutationFn: (id: string) => api.del(`/api/tokens/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['tokens'] }); setRevoke(null); toast({ kind: 'success', title: 'Token widerrufen' }); } });
  const saveGh = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put('/api/github/config', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['github'] }); qc.invalidateQueries({ queryKey: ['integrations'] }); setGhToken(''); setWebhookSecret(''); toast({ kind: 'success', title: 'GitHub-Einstellungen gespeichert', body: 'Geheimnisse werden verschlüsselt gespeichert und nie wieder angezeigt.' }); },
    onError: (e: ApiError) => toast({ kind: 'error', title: 'Nicht gespeichert', body: e.message }),
  });
  const origin = location.origin;
  const mcpCmd = `claude mcp add --transport stdio --env OMEGA_URL=${origin} --env OMEGA_TOKEN=${created ?? '<DEIN_TOKEN>'} omega -- node /pfad/zu/omega-infinity/dist/mcp/index.js`;
  const copy = (t: string) => { navigator.clipboard.writeText(t); toast({ kind: 'success', title: 'Kopiert' }); };

  return (
    <div className="stack">
      {integ.data && (
        <div className="grid-3">
          {(['claude', 'github', 'ai'] as const).map((k) => (
            <div key={k} className="card stack-sm"><div className="row"><HealthDot health={integ.data[k].health} /><strong className="small">{integ.data[k].label}</strong></div><span className="subtle xsmall">{HEALTH_LABELS[integ.data[k].health]}</span><p className="muted small">{integ.data[k].description}</p></div>
          ))}
        </div>
      )}
      <Card title="Claude-Anbindung (MCP-Server & Ingest-API)" icon={<Bot />}>
        <div className="stack">
          <Callout title="So funktioniert es">Claude Code ruft die Werkzeuge des OMEGA-MCP-Servers auf (z. B. <code>omega_upsert_project</code>, <code>omega_report_progress</code>). Der MCP-Server sendet strukturierte, validierte Ereignisse (<code>omega.ingest/v1</code>) an diese Instanz. OMEGA hat <strong>keinen</strong> Zugriff auf deine Claude.ai-Unterhaltungen oder -Projekte – es kommt nur an, was Claude aktiv übermittelt.</Callout>
          <div className="form-grid">
            <Field label="Name des Tokens">{(id) => <input id={id} className="input" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />}</Field>
            <div className="field"><span className="label">Berechtigungen</span><Switch checked={withRead} onChange={setWithRead} label="Zusätzlich Lesen bekannter IDs (omega_list)" /></div>
          </div>
          <div><Button variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={!tokenName.trim()}><KeyRound /> Token erzeugen</Button></div>
          {created && (
            <Callout kind="ok" title="Token – wird nur jetzt einmal angezeigt">
              <div className="row"><code style={{ wordBreak: 'break-all' }}>{created}</code><Button size="sm" onClick={() => copy(created)}><Copy /> Kopieren</Button></div>
            </Callout>
          )}
          <div className="field">
            <span className="label">Einrichtung in Claude Code (Terminal)</span>
            <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><pre className="code-view" style={{ padding: 12, whiteSpace: 'pre-wrap', flex: 1, margin: 0 }}>{`npm run build:mcp   # einmalig im OMEGA-Ordner\n${mcpCmd}`}</pre><Button size="sm" icon onClick={() => copy(mcpCmd)} aria-label="Befehl kopieren"><Copy /></Button></div>
            <span className="hint">Syntax laut offizieller Claude-Code-Doku (siehe Claude Wissen → „MCP-Server in Claude Code verbinden“). Pfad an deine Installation anpassen.</span>
          </div>
          <details>
            <summary className="small" style={{ cursor: 'pointer' }}>Direkt per API (Skripte, CI) – Beispiel</summary>
            <pre className="code-view" style={{ padding: 12, whiteSpace: 'pre-wrap', marginTop: 8 }}>{`curl -X POST ${origin}/api/ingest/v1/events \\\n  -H "Authorization: Bearer $OMEGA_TOKEN" -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(INGEST_EXAMPLE).slice(0, 400)}…'`}</pre>
          </details>
          {tokens.data && tokens.data.length > 0 && (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Name</th><th>Bereiche</th><th>Endung</th><th>Zuletzt genutzt</th><th>Status</th><th /></tr></thead>
              <tbody>{tokens.data.map((t) => (
                <tr key={t.id}><td>{t.name}</td><td>{t.scopes.join(', ')}</td><td className="mono">…{t.token_hint}</td><td>{t.last_used_at ? relTime(t.last_used_at) : 'nie'}</td>
                  <td>{t.revoked_at ? <span className="badge unknown">widerrufen</span> : <span className="badge ok">aktiv</span>}</td>
                  <td>{!t.revoked_at && <Button size="sm" variant="ghost" onClick={() => setRevoke(t.id)}>Widerrufen</Button>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </Card>
      <Card title="GitHub (nur lesend)" icon={<GitBranch />}>
        {!gh.data ? <Skeleton h={160} /> : (
          <div className="stack">
            <Callout>{gh.data.permissions} Empfohlen: Fine-grained Personal Access Token mit <strong>Metadata: Read</strong> und <strong>Contents: Read</strong> für die gewünschten Repositories.</Callout>
            <div className="form-grid">
              <Field label="Personal Access Token" hint={gh.data.envToken ? 'Wird über GITHUB_TOKEN (Umgebung) gesetzt – hat Vorrang.' : gh.data.tokenInfo.stored ? `Gespeichert (${gh.data.tokenInfo.hint}) – verschlüsselt, nicht abrufbar.` : 'Ohne Token: nur öffentliche Repositories (60 Anfragen/Std.).'}>
                {(id) => <input id={id} className="input mono" type="password" autoComplete="off" value={ghToken} onChange={(e) => setGhToken(e.target.value)} placeholder="github_pat_…" disabled={gh.data!.envToken} />}
              </Field>
              <Field label="Webhook-Secret" hint={gh.data.webhookConfigured ? 'Eingerichtet.' : 'Mind. 16 Zeichen. Für sofortige Aktualisierung per Webhook (optional).'}>
                {(id) => <input id={id} className="input mono" type="password" autoComplete="off" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />}
              </Field>
              <Field label="Abgleich-Intervall (Minuten)">{(id) => <input id={id} className="input" type="number" min={5} max={1440} defaultValue={gh.data!.settings.pollMinutes} onBlur={(e) => saveGh.mutate({ pollMinutes: Number(e.target.value) })} />}</Field>
              <div className="field"><span className="label">Optionen</span>
                <Switch checked={gh.data.settings.autoDiscover} onChange={(v) => saveGh.mutate({ autoDiscover: v })} label="Repositories automatisch erkennen (mit Token)" />
                <Switch checked={gh.data.settings.analyzeOnSync} onChange={(v) => saveGh.mutate({ analyzeOnSync: v })} label="Code bei neuem Stand analysieren" />
              </div>
            </div>
            {gh.data.webhookUrl && <p className="small">Webhook-URL für GitHub: <code>{gh.data.webhookUrl}</code> (Content type: application/json, Ereignisse: push, repository)</p>}
            <div className="row">
              <Button variant="primary" disabled={!ghToken && !webhookSecret} loading={saveGh.isPending} onClick={() => saveGh.mutate({ ...(ghToken ? { token: ghToken } : {}), ...(webhookSecret ? { webhookSecret } : {}) })}>Speichern</Button>
              {gh.data.tokenInfo.stored && <Button variant="ghost" onClick={() => saveGh.mutate({ token: null })}>Gespeichertes Token entfernen</Button>}
            </div>
          </div>
        )}
      </Card>
      <Card title="Claude API (optionale KI-Funktionen)" icon={<Sparkles />}>
        <p className="muted small">{integ.data?.ai.description}</p>
        <p className="subtle xsmall" style={{ marginTop: 8 }}>Der API-Schlüssel wird ausschließlich als Umgebungsvariable <code>ANTHROPIC_API_KEY</code> auf dem Server gesetzt – nie im Browser. Genutzt für: Ideengenerierung im Idea Hub und Fragen an OMI im Code Explorer. Modell: <code>{integ.data?.ai.model}</code>.</p>
      </Card>
      <ConfirmDialog open={Boolean(revoke)} onClose={() => setRevoke(null)} onConfirm={() => revoke && doRevoke.mutate(revoke)} danger title="Token widerrufen?" confirmLabel="Widerrufen">Anwendungen mit diesem Token (z. B. der MCP-Server) können danach nichts mehr übermitteln.</ConfirmDialog>
    </div>
  );
}

function Categories() {
  const qc = useQueryClient();
  const toast = useToast();
  const cats = useCategories();
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [icon, setIcon] = useState('tag');
  const [color, setColor] = useState('#8d95ff');
  const create = useMutation({ mutationFn: () => api.post('/api/categories', { name, parentId: parent || null, icon, color }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); setName(''); toast({ kind: 'success', title: 'Kategorie angelegt' }); }, onError: (e: ApiError) => toast({ kind: 'error', title: 'Nicht angelegt', body: e.message }) });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/api/categories/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }), onError: (e: ApiError) => toast({ kind: 'warning', title: 'Nicht gelöscht', body: e.message }) });
  return (
    <div className="stack">
      <Card title="Neue Kategorie" icon={<Plus />}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
          <input className="input" style={{ flex: '1 1 200px' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name der Kategorie" />
          <select className="select" style={{ flex: '0 1 220px' }} value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Übergeordnete Kategorie"><option value="">Hauptkategorie</option>{cats.data?.map((c: Category) => <option key={c.id} value={c.id}>Unter: {c.name}</option>)}</select>
          <select className="select" style={{ flex: '0 1 150px' }} value={icon} onChange={(e) => setIcon(e.target.value)} aria-label="Icon">{ICON_NAMES.map((n) => <option key={n}>{n}</option>)}</select>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Farbe" style={{ width: 44, height: 38, border: 0, background: 'none' }} />
          <Button type="submit" variant="primary" disabled={!name.trim()} loading={create.isPending}>Anlegen</Button>
        </form>
      </Card>
      <Card title={`Kategorien (${cats.data?.length ?? 0})`} icon={<Tag />}>
        <p className="subtle small" style={{ marginBottom: 10 }}>Kategorien sind Daten, kein Code – sie gelten gemeinsam für Projekte, Apps und Ideen. Verwendete Kategorien können nicht gelöscht werden.</p>
        <div className="grid-2">
          {cats.data?.map((c) => (
            <div key={c.id} className="card" style={{ background: 'var(--surface-2)', padding: 'var(--sp-4)' }}>
              <div className="row"><span style={{ color: c.color ?? undefined }}><Icon name={c.icon} size={18} /></span><strong className="small" style={{ flex: 1 }}>{c.name}</strong><span className="subtle xsmall">{c.idea_count} Ideen · {c.node_count} Projekte</span>{!c.system && <Button size="sm" variant="ghost" icon onClick={() => del.mutate(c.id)} aria-label={`${c.name} löschen`}><Trash2 /></Button>}</div>
              <div className="chips" style={{ marginTop: 8 }}>{c.children.map((s) => <span key={s.id} className="badge outline">{s.name}{!s.system && <button className="btn ghost icon sm" style={{ width: 16, height: 16 }} onClick={() => del.mutate(s.id)} aria-label={`${s.name} löschen`}>×</button>}</span>)}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Security() {
  const qc = useQueryClient();
  const toast = useToast();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ id: string; created_at: string; last_seen_at: string; user_agent: string | null; ip: string | null; current: boolean }[]>('/api/me/sessions') });
  const [pw, setPw] = useState({ current: '', next: '', next2: '' });
  const change = useMutation({ mutationFn: () => api.post('/api/me/password', { current: pw.current, next: pw.next }), onSuccess: () => { setPw({ current: '', next: '', next2: '' }); qc.invalidateQueries({ queryKey: ['sessions'] }); toast({ kind: 'success', title: 'Passwort geändert', body: 'Andere Sitzungen wurden abgemeldet.' }); }, onError: (e: ApiError) => toast({ kind: 'error', title: 'Nicht geändert', body: e.message }) });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/api/me/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  return (
    <div className="grid-2">
      <Card title="Passwort ändern" icon={<KeyRound />}>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
          <Field label="Aktuelles Passwort">{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((s) => ({ ...s, current: e.target.value }))} />}</Field>
          <Field label="Neues Passwort" hint="Mindestens 10 Zeichen">{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((s) => ({ ...s, next: e.target.value }))} />}</Field>
          <Field label="Wiederholen" error={pw.next2 && pw.next !== pw.next2 ? 'Stimmt nicht überein' : undefined}>{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={pw.next2} onChange={(e) => setPw((s) => ({ ...s, next2: e.target.value }))} />}</Field>
          <Button type="submit" variant="primary" disabled={!pw.current || pw.next.length < 10 || pw.next !== pw.next2} loading={change.isPending}>Ändern</Button>
        </form>
      </Card>
      <Card title="Aktive Sitzungen" icon={<Monitor />}>
        <div className="list">{sessions.data?.map((s) => (
          <div key={s.id} className="list-item"><span style={{ flex: 1, minWidth: 0 }}><span className="small truncate" style={{ display: 'block' }}>{s.user_agent ?? 'Unbekanntes Gerät'}</span><span className="subtle xsmall">{s.ip} · seit {dateTime(s.created_at)} · aktiv {relTime(s.last_seen_at)}</span></span>{s.current ? <span className="badge ok">Diese Sitzung</span> : <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Abmelden</Button>}</div>
        ))}</div>
      </Card>
      <Card title="Sicherheitsprinzipien" icon={<ShieldCheck />} className="">
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Standardmäßig verweigert: jeder Endpunkt außer Login braucht eine Sitzung</li>
          <li>Cookies: HttpOnly, SameSite=Strict; CSRF-Schutz über eigenen Header</li>
          <li>API-Tokens nur für die Ingest-Schnittstelle, gehasht gespeichert, widerrufbar</li>
          <li>GitHub ausschließlich lesend; Geheimnis-Dateien werden nie angezeigt</li>
          <li>Gespeicherte Geheimnisse AES-256-GCM-verschlüsselt, nie an den Browser</li>
          <li>Rate-Limits für Login, Ingest und Webhooks</li>
        </ul>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'appearance';
  return (
    <div>
      <PageHeader title="Einstellungen" lead="Darstellung, Integrationen, Kategorien und Sicherheit." />
      <Tabs label="Einstellungsbereiche" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={[{ id: 'appearance', label: 'Darstellung', icon: <Palette /> }, { id: 'integrations', label: 'Integrationen', icon: <Bot /> }, { id: 'categories', label: 'Kategorien', icon: <Tag /> }, { id: 'security', label: 'Sicherheit', icon: <ShieldCheck /> }]} />
      {tab === 'appearance' && <Appearance />}
      {tab === 'integrations' && <Integrations />}
      {tab === 'categories' && <Categories />}
      {tab === 'security' && <Security />}
    </div>
  );
}
