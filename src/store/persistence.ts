import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'bpd-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('state')) {
          db.createObjectStore('state', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveToIndexedDB<T>(key: string, value: T): Promise<void> {
  try {
    const db = await getDB();
    await db.put('state', { key, value });
  } catch (err) {
    console.warn('[bpd:idb] save failed:', key, err);
  }
}

export async function loadFromIndexedDB<T>(key: string): Promise<T | null> {
  try {
    const db = await getDB();
    const record = await db.get('state', key);
    return record?.value ?? null;
  } catch (err) {
    console.warn('[bpd:idb] load failed:', key, err);
    return null;
  }
}

export async function clearIndexedDB(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear('state');
  } catch {
    // ignore
  }
}
