import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import type { RecordList, Row } from '../api.js';
import { APP } from '../config.js';
import { useI18n } from '../i18n.js';
import type { Lang } from '../i18n.js';

function cell(row: Row, column: string, lang: Lang): string {
  if (column === 'name') return String((lang === 'ar' ? row.name_ar : row.name_en) || row.name_en || row.name_ar || '');
  const value = row[column];
  return typeof value === 'number' ? value.toLocaleString(lang === 'ar' ? 'ar-QA' : 'en-GB') : String(value ?? '');
}

export function ListPage() {
  const { lang, t } = useI18n();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<RecordList | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    setFailed(false);
    api.records(query, page).then(
      (result) => current && setList(result),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [query, page]);

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(draft);
  }

  return (
    <section>
      <h1>{APP.listTitle[lang]}</h1>
      <form className="search" role="search" onSubmit={search}>
        <label htmlFor="q">{APP.searchHint[lang]}</label>
        <div className="row">
          <input id="q" name="q" type="search" dir="auto" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit">{t('search')}</button>
        </div>
      </form>
      {failed && <p role="alert">{t('failed')}</p>}
      {!list && !failed && <p role="status">{t('loading')}</p>}
      {list && (
        <>
          <p className="muted" role="status">
            {list.total} {t('results')} · {list.notice}
          </p>
          {list.items.length === 0 ? (
            <p>{t('noResults')}</p>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    {APP.columns.map((column) => (
                      <th key={column} scope="col">
                        {t(`f.${column}`)}
                      </th>
                    ))}
                    <th scope="col">{t('details')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((row) => (
                    <tr key={String(row.id)}>
                      {APP.columns.map((column) => (
                        <td key={column} dir="auto">
                          {cell(row, column, lang)}
                        </td>
                      ))}
                      <td>
                        <Link to={`/record/${encodeURIComponent(String(row.id))}`}>{t('open')}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pager">
            <button type="button" disabled={list.page <= 1} onClick={() => setPage(list.page - 1)}>
              {t('previous')}
            </button>
            <span>
              {t('page')} {list.page} {t('of')} {list.pages}
            </span>
            <button type="button" disabled={list.page >= list.pages} onClick={() => setPage(list.page + 1)}>
              {t('next')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
