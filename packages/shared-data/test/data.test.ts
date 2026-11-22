import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Row = Record<string, unknown>;
const load = <T = Row[]>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8')) as T;

const smes = load('smes');
const apps = load('loan_applications');
const guarantees = load('guarantees');
const repayments = load('repayments');
const lines = load('statement_lines');
const contacts = load('contacts');
const sectors = new Set(load<{ code: string }[]>('sectors').map((s) => s.code));
const regions = new Set(load<{ code: string }[]>('regions').map((r) => r.code));
const planted = load<{
  duplicates: { ids: string[]; kind: string }[];
  defects: { dataset: string; id: string; field: string; dimension: string }[];
  invalidCodes: { dataset: string; id: string; field: string; value: string }[];
  personalFields: { dataset: string; field: string; misleading: boolean }[];
  decoys: { dataset: string; field: string }[];
}>('planted');
const datasets: Record<string, Row[]> = { smes, loan_applications: apps, guarantees, repayments, statement_lines: lines, contacts };
const byId = (rows: Row[], key: string) => new Map(rows.map((r) => [r[key] as string, r]));

describe('shared data', () => {
  it('has the specified volumes', () => {
    expect([smes.length, apps.length, guarantees.length, repayments.length, lines.length]).toEqual([400, 900, 600, 5000, 300]);
  });

  it('carries real Arabic script in every Arabic name', () => {
    for (const s of smes) expect(s.name_ar).toMatch(/[؀-ۿ]{3,}/);
  });

  it('gives no two people the same full name', () => {
    const nameByQid = new Map<string, string>();
    for (const s of smes) nameByQid.set(s.owner_qid as string, s.owner_name as string);
    for (const g of guarantees) nameByQid.set(g.guarantor_qid as string, g.guarantor_name as string);
    for (const c of contacts) nameByQid.set(c.legacy_key as string, c.full_name as string);
    const names = [...nameByQid.values()];
    expect(new Set(names).size).toBe(names.length);
  });

  it('planted.duplicates lists 15 pairs that share an owner', () => {
    expect(planted.duplicates).toHaveLength(15);
    const index = byId(smes, 'sme_id');
    for (const d of planted.duplicates) {
      const [a, b] = d.ids.map((id) => index.get(id));
      expect(a?.owner_qid).toBe(b?.owner_qid);
    }
    expect(new Set(planted.duplicates.map((d) => d.kind)).size).toBe(5);
  });

  it('planted.defects lists 25 defects over four dimensions, each present in the data', () => {
    expect(planted.defects).toHaveLength(25);
    expect(new Set(planted.defects.map((d) => d.dimension))).toEqual(new Set(['completeness', 'validity', 'consistency', 'timeliness']));
    const idKey: Record<string, string> = { smes: 'sme_id', repayments: 'repayment_id', guarantees: 'guarantee_id' };
    for (const d of planted.defects) {
      const row = byId(datasets[d.dataset]!, idKey[d.dataset]!).get(d.id);
      expect(row, `${d.dataset} ${d.id}`).toBeDefined();
    }
    const sme = byId(smes, 'sme_id');
    for (const d of planted.defects.filter((x) => x.field === 'cr_number')) expect(sme.get(d.id)?.cr_number).toBe('');
    for (const d of planted.defects.filter((x) => x.field === 'iban')) expect(sme.get(d.id)?.iban).not.toMatch(/^QA\d{2}[A-Z]{4}[A-Z0-9]{21}$/);
    const app = byId(apps, 'application_id');
    const rep = byId(repayments, 'repayment_id');
    for (const d of planted.defects.filter((x) => x.field === 'paid_date')) {
      const r = rep.get(d.id)!;
      expect((r.paid_date as string) < (app.get(r.application_id as string)!.disbursed_at as string)).toBe(true);
    }
  });

  it('planted.invalidCodes lists exactly the 12 rows whose code is not in the reference lists', () => {
    expect(planted.invalidCodes).toHaveLength(12);
    const found = [
      ...smes.filter((s) => !sectors.has(s.sector_code as string)).map((s) => `smes ${s.sme_id} sector_code`),
      ...smes.filter((s) => !regions.has(s.region_code as string)).map((s) => `smes ${s.sme_id} region_code`),
      ...apps.filter((a) => !sectors.has(a.sector_code as string)).map((a) => `loan_applications ${a.application_id} sector_code`),
    ].sort();
    expect(planted.invalidCodes.map((c) => `${c.dataset} ${c.id} ${c.field}`).sort()).toEqual(found);
  });

  it('planted.personalFields lists 20 fields, four with misleading names, all present', () => {
    expect(planted.personalFields).toHaveLength(20);
    expect(planted.personalFields.filter((f) => f.misleading).map((f) => f.field).sort()).toEqual(['aux_code', 'legacy_key', 'notes', 'ref2']);
    for (const f of planted.personalFields) expect(datasets[f.dataset]![0]).toHaveProperty(f.field);
    expect(smes.some((s) => /^[23]\d{10}$/.test(s.ref2 as string))).toBe(true);
    expect(smes.some((s) => /\+974 \d{4} \d{4}/.test(s.notes as string))).toBe(true);
  });

  it('planted.decoys lists 10 fields that hold no personal data', () => {
    expect(planted.decoys).toHaveLength(10);
    for (const f of planted.decoys) {
      const values = new Set(datasets[f.dataset]!.map((r) => String(r[f.field])));
      expect(values.size, `${f.dataset}.${f.field}`).toBe(1);
    }
  });
});
