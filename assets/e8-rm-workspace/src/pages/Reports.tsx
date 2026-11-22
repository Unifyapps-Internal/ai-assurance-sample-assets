import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { ReportGroup } from '../api.js';
import { useI18n } from '../i18n.js';

export function ReportsPage() {
  const { lang, t } = useI18n();
  const [report, setReport] = useState<{ groups: ReportGroup[]; notice: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.reports().then(setReport, () => setFailed(true));
  }, []);
  const number = (value: number) => value.toLocaleString(lang === 'ar' ? 'ar-QA' : 'en-GB');

  return (
    <section>
      <h1>{t('reports')}</h1>
      {failed && <p role="alert">{t('failed')}</p>}
      {!report && !failed && <p role="status">{t('loading')}</p>}
      {report && <p className="muted">{report.notice}</p>}
      {report?.groups.map((group) => (
        <table key={group.key}>
          <caption>{t(group.key)}</caption>
          <thead>
            <tr>
              <th scope="col">{t('group')}</th>
              <th scope="col">{t('count')}</th>
              <th scope="col">{t('f.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{number(row.count)}</td>
                <td>{number(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </section>
  );
}
