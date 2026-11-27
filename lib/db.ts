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

export interface CachedChapter {
  url: string;
  title: string;
  content: string;
  nextUrl: string | null;
  prevUrl: string | null;
  sourceDomain: string;
  cachedAt: number;
}

export interface BookshelfEntry {
  seriesKey: string;
  seriesName: string;
  url: string;
  chapterTitle: string;
  content: string;
  nextUrl: string | null;
  prevUrl: string | null;
  sourceDomain: string;
  chunkIndex: number;
  totalChunks: number;
  voice: string;
  rate: number;
  pitch: number;
  updatedAt: number;
}

const DB_NAME = 'audifox';
const STORE = 'session';
const CHAPTER_STORE = 'chapters';
const BOOKSHELF_STORE = 'bookshelf';
const VERSION = 3;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CHAPTER_STORE)) {
        db.createObjectStore(CHAPTER_STORE, { keyPath: 'url' });
      }
      if (!db.objectStoreNames.contains(BOOKSHELF_STORE)) {
        db.createObjectStore(BOOKSHELF_STORE, { keyPath: 'seriesKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function deriveSeriesKey(url: string, title: string): { seriesKey: string; seriesName: string } {
  if (url) {
    try {
      const u = new URL(url);
      // Strip trailing chapter segment (/doc/1, /chuong-1, /chapter-2, /c12, etc.)
      const strippedPath = u.pathname
        .replace(/\/(doc|chuong|chapter|chap|c)[-_\/]?\d+\/?$/i, '')
        .replace(/\/\d+\/?$/, '')
        .replace(/\/+$/, '');
      const slug = strippedPath.split('/').filter(Boolean).pop() || u.hostname;
      const readableName = slug
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        seriesKey: `${u.hostname}${strippedPath || '/'}`,
        seriesName: readableName || title || u.hostname,
      };
    } catch {}
  }
  const cleanTitle = (title || 'Truyện đã lưu').replace(/^(chương|hồi|chapter)\s+\d+[:.\-\s]*/i, '').trim();
  const key = (cleanTitle || title || 'local').toLowerCase().slice(0, 80);
  return { seriesKey: `local:${key}`, seriesName: cleanTitle || title || 'Truyện đã lưu' };
}

export async function saveToBookshelf(entry: Omit<BookshelfEntry, 'updatedAt'>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKSHELF_STORE, 'readwrite');
    tx.objectStore(BOOKSHELF_STORE).put({ ...entry, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listBookshelf(): Promise<BookshelfEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKSHELF_STORE, 'readonly');
    const req = tx.objectStore(BOOKSHELF_STORE).getAll();
    req.onsuccess = () => {
      const items = (req.result as BookshelfEntry[]) || [];
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFromBookshelf(seriesKey: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKSHELF_STORE, 'readwrite');
    tx.objectStore(BOOKSHELF_STORE).delete(seriesKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function cacheChapter(chapter: Omit<CachedChapter, 'cachedAt'>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHAPTER_STORE, 'readwrite');
    tx.objectStore(CHAPTER_STORE).put({ ...chapter, cachedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedChapter(url: string): Promise<CachedChapter | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHAPTER_STORE, 'readonly');
    const req = tx.objectStore(CHAPTER_STORE).get(url);
    req.onsuccess = () => resolve(req.result ?? null);
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
