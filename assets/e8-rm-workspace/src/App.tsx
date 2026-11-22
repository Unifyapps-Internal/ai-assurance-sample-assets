import { NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.js';
import { APP } from './config.js';
import { useI18n } from './i18n.js';
import { routes } from './routes.js';

export function App() {
  const { user, signOut } = useAuth();
  const { lang, t, toggle } = useI18n();
  const may = (roles: readonly string[]) => user != null && roles.includes(user.role);
  return (
    <>
      <header className="top">
        <div className="brand">
          <span className="title">{APP.title[lang]}</span>
          <span className="badge" title={t('testAssetNote')}>
            {t('testAsset')}
          </span>
        </div>
        {user ? (
          <nav aria-label={APP.title[lang]}>
            <NavLink to="/" end>
              {t('list')}
            </NavLink>
            {may(APP.reportRoles) && <NavLink to="/reports">{t('reports')}</NavLink>}
            {may(APP.adminRoles) && <NavLink to="/admin">{t('admin')}</NavLink>}
          </nav>
        ) : null}
        <div className="tools">
          <button type="button" className="link" onClick={toggle} lang={lang === 'en' ? 'ar' : 'en'}>
            {t('language')}
          </button>
          {user ? (
            <>
              <span className="who">
                {user.displayName} ({user.role})
              </span>
              <button type="button" onClick={() => void signOut()}>
                {t('signOut')}
              </button>
            </>
          ) : null}
        </div>
      </header>
      <main>
        <Routes>
          {routes.map((route) => (
            <Route key={route.path} path={route.path} element={route.element} />
          ))}
          <Route path="*" element={<p role="alert">{t('notFound')}</p>} />
        </Routes>
      </main>
      <footer>
        {t('testAsset')}. {t('testAssetNote')}
      </footer>
    </>
  );
}
