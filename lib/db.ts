// lib/db.ts – IndexedDB persistence layer

export interface SessionData {
  id: 'current';
  url: string;
  title: string;
  content: string;
  nextUrl: string | null;
  sourceDomain?: string;
  chunkIndex: number;
  totalChunks?: number;
  voice: string;
  rate: number;
  pitch: number;
  theme: 'dark' | 'sepia' | 'light';
  fontSize: number;
  fontFamily: string;
  autoNext: boolean;
  volume: number;
  savedAt: number;
}

const DB_NAME = 'audifox';
const STORE = 'session';
const VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSession(data: Omit<SessionData, 'id' | 'savedAt'>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...data, id: 'current', savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadSession(): Promise<SessionData | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get('current');
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearSession(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete('current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
