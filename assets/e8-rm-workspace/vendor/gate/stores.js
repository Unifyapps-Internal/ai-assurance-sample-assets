import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export class MemoryStore {
    kind = 'memory';
    state = null;
    async read() {
        return this.state ? structuredClone(this.state) : null;
    }
    async write(state) {
        this.state = structuredClone(state);
    }
}
export class FileStore {
    path;
    kind = 'file';
    constructor(path) {
        this.path = path;
    }
    async read() {
        try {
            return JSON.parse(await readFile(this.path, 'utf8'));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return null;
            throw error;
        }
    }
    async write(state) {
        await mkdir(dirname(this.path), { recursive: true });
        const temp = `${this.path}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(state, null, 2));
        await rename(temp, this.path);
    }
}
function vercelBlobClient(token, access) {
    return {
        async put(pathname, body) {
            const { put } = await import('@vercel/blob');
            await put(pathname, body, { access, token, addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });
        },
        async get(pathname) {
            const { get } = await import('@vercel/blob');
            const result = await get(pathname, { access, token, useCache: false });
            if (!result || result.statusCode !== 200)
                return null;
            return new Response(result.stream).text();
        },
    };
}
export class BlobStore {
    kind = 'blob';
    client;
    pathname;
    constructor(options) {
        if (!options.client && !options.token)
            throw new Error('BlobStore needs a token or a client');
        this.client = options.client ?? vercelBlobClient(options.token, options.access ?? 'private');
        this.pathname = `assurance-gate/${options.assetId}/policy.json`;
    }
    async read() {
        const text = await this.client.get(this.pathname);
        return text === null ? null : JSON.parse(text);
    }
    async write(state) {
        await this.client.put(this.pathname, JSON.stringify(state));
    }
}
/**
 * BlobStore when BLOB_READ_WRITE_TOKEN exists (ASSURANCE_BLOB_ACCESS = private by default, or public to match
 * the Blob store's kind), otherwise a FileStore at the given path.
 */
export function storeFromEnv(options) {
    const env = options.env ?? process.env;
    const token = env.BLOB_READ_WRITE_TOKEN;
    if (!token)
        return new FileStore(options.filePath);
    return new BlobStore({ assetId: options.assetId, token, access: env.ASSURANCE_BLOB_ACCESS === 'public' ? 'public' : 'private' });
}
