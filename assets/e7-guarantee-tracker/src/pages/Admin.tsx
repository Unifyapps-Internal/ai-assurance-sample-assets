import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { User } from '../api.js';
import { useI18n } from '../i18n.js';

export function AdminPage() {
  const { t } = useI18n();
  const [data, setData] = useState<{ users: User[]; notice: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.users().then(setData, () => setFailed(true));
  }, []);

  return (
    <section>
      <h1>{t('admin')}</h1>
      {failed && <p role="alert">{t('failed')}</p>}
      {!data && !failed && <p role="status">{t('loading')}</p>}
      {data && (
        <>
          <p className="muted">{data.notice}</p>
          <table>
            <caption>{t('users')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('username')}</th>
                <th scope="col">{t('displayName')}</th>
                <th scope="col">{t('role')}</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr key={user.username}>
                  <th scope="row">{user.username}</th>
                  <td>{user.displayName}</td>
                  <td>{user.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
