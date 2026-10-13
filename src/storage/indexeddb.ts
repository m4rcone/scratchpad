/**
 * Draft storage on IndexedDB: no practical size ceiling and asynchronous
 * writes, so saving never blocks typing.
 */
import type { Draft, DraftStore } from './types.ts';

const DB_NAME = 'scratchpad';
const DB_VERSION = 1;
const STORE = 'drafts';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = body(tx.objectStore(STORE));
    // A write request succeeds before its transaction commits, and the
    // transaction can still abort afterwards on quota or a disk error. The
    // caller drops the synchronous mirror the moment this promise resolves,
    // so for a write the promise waits for the commit, not for the request.
    if (mode === 'readonly') request.onsuccess = () => resolve(request.result);
    else tx.oncomplete = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('request failed'));
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export function indexedDbStore(): DraftStore {
  let db: Promise<IDBDatabase> | null = null;
  // A failed open is not kept: the store's retry would otherwise be handed
  // the same rejection forever, and the footer would say "not saved" for the
  // rest of the session even once the disk is back. A connection Chrome
  // closes under the page (storage cleared, disk gone) is dropped the same way.
  const database = () =>
    (db ??= openDatabase().then(
      (opened) => {
        opened.onclose = () => (db = null);
        return opened;
      },
      (error: unknown) => {
        db = null;
        throw error;
      },
    ));

  return {
    async all() {
      const drafts = await run<Draft[]>(await database(), 'readonly', (store) =>
        store.getAll(),
      );
      return drafts.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async put(draft) {
      // Copied now: the draft is one mutable object, and the write below
      // happens only once the read has answered.
      const copy = { ...draft };
      await run(await database(), 'readwrite', (store) => {
        const read = store.get(copy.id);
        read.onsuccess = () => {
          const stored = read.result as Draft | undefined;
          if (!stored || stored.updatedAt <= copy.updatedAt) store.put(copy);
        };
        return read;
      });
    },
    async remove(id) {
      await run(await database(), 'readwrite', (store) => store.delete(id));
    },
  };
}
