import type { PolicyStore, StoredPolicies } from './types.js';
export declare class MemoryStore implements PolicyStore {
    readonly kind = "memory";
    private state;
    read(): Promise<StoredPolicies | null>;
    write(state: StoredPolicies): Promise<void>;
}
export declare class FileStore implements PolicyStore {
    private readonly path;
    readonly kind = "file";
    constructor(path: string);
    read(): Promise<StoredPolicies | null>;
    write(state: StoredPolicies): Promise<void>;
}
/** The two calls the gate needs from Vercel Blob; injectable so tests never touch the network. */
export interface BlobClient {
    put(pathname: string, body: string): Promise<void>;
    get(pathname: string): Promise<string | null>;
}
export declare class BlobStore implements PolicyStore {
    readonly kind = "blob";
    private readonly client;
    private readonly pathname;
    constructor(options: {
        assetId: string;
        token?: string;
        access?: 'public' | 'private';
        client?: BlobClient;
    });
    read(): Promise<StoredPolicies | null>;
    write(state: StoredPolicies): Promise<void>;
}
/**
 * BlobStore when BLOB_READ_WRITE_TOKEN exists (ASSURANCE_BLOB_ACCESS = private by default, or public to match
 * the Blob store's kind), otherwise a FileStore at the given path.
 */
export declare function storeFromEnv(options: {
    assetId: string;
    filePath: string;
    env?: NodeJS.ProcessEnv;
}): PolicyStore;
