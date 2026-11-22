import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth.js';
import { useI18n } from '../i18n.js';

export function LoginPage() {
  const { user, signIn } = useAuth();
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      await signIn(username, password);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card narrow" onSubmit={(event) => void submit(event)}>
      <h1>{t('signIn')}</h1>
      <label htmlFor="username">{t('username')}</label>
      <input id="username" name="username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
      <label htmlFor="password">{t('password')}</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {failed && <p role="alert">{t('loginFailed')}</p>}
      <button type="submit" disabled={busy}>
        {t('signIn')}
      </button>
    </form>
  );
}
