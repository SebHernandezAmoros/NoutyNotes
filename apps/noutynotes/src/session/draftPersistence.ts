import { PersistentDraftStore } from '@noutynotes/application';
import type { DraftPersistence, DraftStore } from '@noutynotes/application';

const DATABASE = 'noutynotes-private-drafts';
const STORE = 'snapshots';
const KEY = 'editorial-v1';

/** IndexedDB privado del origen; nunca usa localStorage ni forma parte del ZIP. */
export class IndexedDbDraftPersistence implements DraftPersistence {
  constructor(private readonly factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB) {}

  async read(): Promise<string | null> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
      transaction.oncomplete = () => database.close();
    });
  }

  async write(serialized: string): Promise<void> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(serialized, KEY);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('IndexedDB write failed')); };
      transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('IndexedDB write aborted')); };
    });
  }

  private open(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error('IndexedDB unavailable'));
    return new Promise((resolve, reject) => {
      const request = this.factory?.open(DATABASE, 1);
      if (!request) { reject(new Error('IndexedDB unavailable')); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
  }
}

export function createDeviceDraftStore(): DraftStore {
  return new PersistentDraftStore(new IndexedDbDraftPersistence(), { now: () => new Date().toISOString() });
}
