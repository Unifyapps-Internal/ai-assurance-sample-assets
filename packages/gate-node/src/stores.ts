import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PolicyStore, StoredPolicies } from './types.js';

export class MemoryStore implements PolicyStore {
  readonly kind = 'memory';
  private state: StoredPolicies | null = null;

  async read(): Promise<StoredPolicies | null> {
    return this.state ? structuredClone(this.state) : null;
  }

  async write(state: StoredPolicies): Promise<void> {
    this.state = structuredClone(state);
  }
}

export class FileStore implements PolicyStore {
  readonly kind = 'file';
  constructor(private readonly path: string) {}

  async read(): Promise<StoredPolicies | null> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as StoredPolicies;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(state: StoredPolicies): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2));
    await rename(temp, this.path);
  }
}

/** The two calls the gate needs from Vercel Blob; injectable so tests never touch the network. */
export interface BlobClient {
  put(pathname: string, body: string): Promise<void>;
  get(pathname: string): Promise<string | null>;
}

function vercelBlobClient(token: string, access: 'public' | 'private'): BlobClient {
  return {
    async put(pathname, body) {
      const { put } = await import('@vercel/blob');
      await put(pathname, body, { access, token, addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });
    },
    async get(pathname) {
      const { get } = await import('@vercel/blob');
      const result = await get(pathname, { access, token, useCache: false });
      if (!result || result.statusCode !== 200) return null;
      return new Response(result.stream).text();
    },
  };
}

export class BlobStore implements PolicyStore {
  readonly kind = 'blob';
  private readonly client: BlobClient;
  private readonly pathname: string;

  constructor(options: { assetId: string; token?: string; access?: 'public' | 'private'; client?: BlobClient }) {
    if (!options.client && !options.token) throw new Error('BlobStore needs a token or a client');
    this.client = options.client ?? vercelBlobClient(options.token as string, options.access ?? 'private');
    this.pathname = `assurance-gate/${options.assetId}/policy.json`;
  }

  async read(): Promise<StoredPolicies | null> {
    const text = await this.client.get(this.pathname);
    return text === null ? null : (JSON.parse(text) as StoredPolicies);
  }

  async write(state: StoredPolicies): Promise<void> {
    await this.client.put(this.pathname, JSON.stringify(state));
  }
}

/**
 * BlobStore when BLOB_READ_WRITE_TOKEN exists (ASSURANCE_BLOB_ACCESS = private by default, or public to match
 * the Blob store's kind), otherwise a FileStore at the given path.
 */
export function storeFromEnv(options: { assetId: string; filePath: string; env?: NodeJS.ProcessEnv }): PolicyStore {
  const env = options.env ?? process.env;
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return new FileStore(options.filePath);
  return new BlobStore({ assetId: options.assetId, token, access: env.ASSURANCE_BLOB_ACCESS === 'public' ? 'public' : 'private' });
}
