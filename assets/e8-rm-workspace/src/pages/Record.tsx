import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import type { Row, Summary } from '../api.js';
import { useI18n } from '../i18n.js';
import type { Lang } from '../i18n.js';

/** Rows to show: fields that exist in both languages (sector_en, sector_ar) appear once, in the page language. */
function visible(record: Row, lang: Lang): [string, string][] {
  const other = lang === 'ar' ? '_en' : '_ar';
  return Object.entries(record)
    .filter(([key]) => key.startsWith('name_') || !key.endsWith(other))
    .map(([key, value]) => [key.startsWith('name_') ? key : key.replace(/_(en|ar)$/, ''), String(value ?? '')]);
}

function FieldTable({ caption, rows }: { caption: string; rows: [string, string][] }) {
  const { t } = useI18n();
  return (
    <table className="fields">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{t('field')}</th>
          <th scope="col">{t('value')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, value]) => (
          <tr key={key}>
            <th scope="row">{t(`f.${key}`)}</th>
            <td dir="auto">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RecordPage() {
  const { id = '' } = useParams();
  const { lang, t } = useI18n();
  const [data, setData] = useState<{ record: Row; loans?: Row[]; notice: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    setData(null);
    setSummary(null);
    setError(null);
    api.record(id).then(
      (result) => current && setData(result),
      (failure: unknown) => current && setError(failure instanceof ApiError && failure.status === 404 ? 'notFound' : 'failed'),
    );
    return () => {
      current = false;
    };
  }, [id]);

  async function generate() {
    setBusy(true);
    setSummaryError(false);
    try {
      setSummary(await api.summary(id));
    } catch {
      setSummaryError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <p>
        <Link to="/">{t('back')}</Link>
      </p>
      {error && <p role="alert">{t(error)}</p>}
      {!data && !error && <p role="status">{t('loading')}</p>}
      {data && (
        <>
          <h1 dir="auto">{String((lang === 'ar' ? data.record.name_ar : data.record.name_en) || data.record.id)}</h1>
          <p className="muted">{data.notice}</p>
          <div className="card">
            <h2>{t('summary')}</h2>
            <button type="button" onClick={() => void generate()} disabled={busy}>
              {busy ? t('generating') : t('generate')}
            </button>
            {summaryError && <p role="alert">{t('summaryUnavailable')}</p>}
            {summary && (
              <div className="summary" aria-live="polite">
                {summary.label && <p className="ai-label">{summary.label}</p>}
                <p dir="auto">{summary.summary}</p>
              </div>
            )}
          </div>
          <FieldTable caption={t('details')} rows={visible(data.record, lang)} />
          {data.loans?.map((loan) => (
            <FieldTable key={String(loan.application_id)} caption={`${t('loans')}: ${String(loan.application_id)}`} rows={visible(loan, lang)} />
          ))}
        </>
      )}
    </section>
  );
}
