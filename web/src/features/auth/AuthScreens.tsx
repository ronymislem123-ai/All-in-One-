import { useState } from 'react';
import { KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { useSession } from '../../lib/session';
import { Button, Callout, Field } from '../../components/ui';
import { Logo } from '../../components/layout/Logo';

export function AuthScreen({ setup }: { setup: boolean }) {
  const { refreshAuth } = useSession();
  const [form, setForm] = useState({ setupCode: '', displayName: '', email: '', password: '', password2: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup && form.password !== form.password2) { setError('Die Passwörter stimmen nicht überein.'); return; }
    setBusy(true);
    try {
      if (setup) await api.post('/api/auth/setup', { setupCode: form.setupCode, displayName: form.displayName, email: form.email, password: form.password });
      else await api.post('/api/auth/login', { email: form.email, password: form.password });
      refreshAuth();
    } catch (err) {
      const e2 = err as ApiError;
      const details = Array.isArray(e2.details) ? (e2.details as { message: string }[]).map((d) => d.message).join(' · ') : '';
      setError(`${e2.message}${details ? ` (${details})` : ''}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-wrap">
      <div className="auth-card rise-in">
        <div className="auth-hero">
          <Logo />
          <h1>{setup ? 'Willkommen bei OMEGA' : 'OMEGA Infinity'}</h1>
          <p className="muted" style={{ marginTop: 8 }}>{setup ? 'Richte dein persönliches digitales Betriebssystem ein.' : 'Dein persönliches digitales Betriebssystem.'}</p>
        </div>
        <form className="card stack" onSubmit={submit} noValidate>
          {setup && (
            <Callout title="Einrichtungscode" icon={<KeyRound />}>
              Der einmalige Code steht im Server-Log (oder in <code>OMEGA_SETUP_CODE</code>). So kann niemand anderes dein System übernehmen.
            </Callout>
          )}
          {setup && (
            <Field label="Einrichtungscode">{(id) => <input id={id} className="input mono" value={form.setupCode} onChange={set('setupCode')} autoComplete="one-time-code" required />}</Field>
          )}
          {setup && <Field label="Dein Name">{(id) => <input id={id} className="input" value={form.displayName} onChange={set('displayName')} autoComplete="name" required />}</Field>}
          <Field label="E-Mail">{(id) => <input id={id} className="input" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />}</Field>
          <Field label="Passwort" hint={setup ? 'Mindestens 10 Zeichen.' : undefined}>
            {(id) => <input id={id} className="input" type="password" value={form.password} onChange={set('password')} autoComplete={setup ? 'new-password' : 'current-password'} required />}
          </Field>
          {setup && <Field label="Passwort wiederholen">{(id) => <input id={id} className="input" type="password" value={form.password2} onChange={set('password2')} autoComplete="new-password" required />}</Field>}
          {error && <Callout kind="crit">{error}</Callout>}
          <Button variant="primary" type="submit" loading={busy} block>{setup ? <><ShieldCheck /> Einrichten</> : <><LogIn /> Anmelden</>}</Button>
        </form>
        <p className="subtle xsmall" style={{ textAlign: 'center', marginTop: 16 }}>Sitzungen sind HttpOnly-Cookies · Passwörter werden mit scrypt gespeichert</p>
      </div>
    </main>
  );
}
