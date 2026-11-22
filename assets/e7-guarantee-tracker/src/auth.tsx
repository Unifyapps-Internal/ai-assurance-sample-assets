import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from './api.js';
import type { User } from './api.js';
import { useI18n } from './i18n.js';

interface Auth {
  /** undefined while /api/me is in flight, null when signed out. */
  user: User | null | undefined;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Context = createContext<Auth>({ user: undefined, signIn: async () => undefined, signOut: async () => undefined });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    api.me().then(
      (me) => setUser(me.user),
      () => setUser(null),
    );
  }, []);
  const signIn = useCallback(async (username: string, password: string) => setUser((await api.login(username, password)).user), []);
  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);
  const value = useMemo(() => ({ user, signIn, signOut }), [user, signIn, signOut]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useAuth = (): Auth => useContext(Context);

/** Route guard: needs a session, and one of the roles when a list is given. */
export function Guard({ roles, children }: { roles?: readonly string[]; children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useI18n();
  if (user === undefined) return <p role="status">{t('loading')}</p>;
  if (user === null) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <p role="alert">{t('forbidden')}</p>;
  return <>{children}</>;
}
