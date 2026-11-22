export interface User {
  username: string;
  displayName: string;
  role: string;
}

export type Row = Record<string, string | number | boolean | null>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(response.status, payload.error ?? response.statusText);
  return payload;
}

export interface RecordList {
  items: Row[];
  total: number;
  page: number;
  pages: number;
  notice: string;
}

export interface Summary {
  summary: string;
  label: string | null;
  model: string;
  notice: string;
}

export interface ReportGroup {
  key: string;
  rows: { label: string; count: number; amount: number }[];
}

export const api = {
  me: () => call<{ user: User }>('/api/me'),
  login: (username: string, password: string) => call<{ user: User }>('/api/login', { username, password }),
  logout: () => call<{ ok: boolean }>('/api/logout', {}),
  records: (q: string, page: number) => call<RecordList>(`/api/records?q=${encodeURIComponent(q)}&page=${page}`),
  record: (id: string) => call<{ record: Row; loans?: Row[]; notice: string }>(`/api/records/${encodeURIComponent(id)}`),
  reports: () => call<{ groups: ReportGroup[]; notice: string }>('/api/reports'),
  users: () => call<{ users: User[]; notice: string }>('/api/admin/users'),
  summary: (id: string) => call<Summary>('/api/ai/summary', { id }),
};
