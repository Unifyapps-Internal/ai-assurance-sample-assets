import type { IncomingMessage, ServerResponse } from 'node:http';

export const NOTICE = 'Test asset. All data is fabricated.';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Reads a JSON body; honours a body the platform has already parsed. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parsed = (req as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined) return asObject(typeof parsed === 'string' ? safeParse(parsed) : parsed);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 100_000) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  return asObject(chunks.length === 0 ? {} : safeParse(Buffer.concat(chunks).toString('utf8')));
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'body is not valid JSON');
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
