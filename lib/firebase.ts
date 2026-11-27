// lib/firebase.ts – Client-side Firebase Auth & Firestore Bookshelf Sync
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  Auth,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  Firestore,
} from 'firebase/firestore';
import type { BookshelfEntry } from '@/lib/db';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function ensureFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } | null {
  if (typeof window === 'undefined' || !isFirebaseConfigured) return null;
  if (!appInstance) {
    appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }
  if (!authInstance) {
    authInstance = getAuth(appInstance);
  }
  if (!dbInstance) {
    dbInstance = getFirestore(appInstance);
  }
  return { app: appInstance, auth: authInstance, db: dbInstance };
}

export function subscribeAuth(callback: (user: User | null) => void): () => void {
  const fb = ensureFirebase();
  if (!fb) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(fb.auth, callback);
}

export async function signInWithGoogle(): Promise<User> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase chưa được cấu hình.');
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(fb.auth, provider);
  return cred.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase chưa được cấu hình.');
  const cred = await signInWithEmailAndPassword(fb.auth, email, password);
  return cred.user;
}

export async function signUpWithEmail(email: string, password: string): Promise<User> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase chưa được cấu hình.');
  const cred = await createUserWithEmailAndPassword(fb.auth, email, password);
  return cred.user;
}

export async function signOutUser(): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  await signOut(fb.auth);
}

// Firestore document shape under users/{uid}/bookshelf/{seriesId}
export interface CloudBookshelfDoc {
  seriesId: string;
  novelTitle: string;
  chapterTitle: string;
  chapterUrl: string;
  nextUrl: string | null;
  prevUrl: string | null;
  sourceDomain: string;
  currentChunkIndex: number;
  totalChunks: number;
  progressPercent: number;
  voice: string;
  rate: number;
  pitch: number;
  updatedAt: number;
}

function encodeSeriesDocId(seriesKey: string): string {
  // Firestore document IDs cannot contain '/'
  return encodeURIComponent(seriesKey).replace(/%/g, '_');
}

export function toCloudDoc(entry: BookshelfEntry): CloudBookshelfDoc {
  const total = Math.max(1, entry.totalChunks || 1);
  const pct = Math.min(100, Math.round(((entry.chunkIndex + 1) / total) * 100));
  return {
    seriesId: entry.seriesKey,
    novelTitle: entry.seriesName,
    chapterTitle: entry.chapterTitle,
    chapterUrl: entry.url,
    nextUrl: entry.nextUrl ?? null,
    prevUrl: entry.prevUrl ?? null,
    sourceDomain: entry.sourceDomain || '',
    currentChunkIndex: entry.chunkIndex,
    totalChunks: total,
    progressPercent: pct,
    voice: entry.voice,
    rate: entry.rate,
    pitch: entry.pitch ?? 0,
    updatedAt: entry.updatedAt || Date.now(),
  };
}

export function fromCloudDoc(docData: CloudBookshelfDoc): BookshelfEntry {
  return {
    seriesKey: docData.seriesId,
    seriesName: docData.novelTitle,
    url: docData.chapterUrl || '',
    chapterTitle: docData.chapterTitle,
    content: '',
    nextUrl: docData.nextUrl ?? null,
    prevUrl: docData.prevUrl ?? null,
    sourceDomain: docData.sourceDomain || '',
    chunkIndex: docData.currentChunkIndex || 0,
    totalChunks: docData.totalChunks || 1,
    voice: docData.voice || 'vi-VN-HoaiMyNeural',
    rate: docData.rate || 1.0,
    pitch: docData.pitch ?? 0,
    updatedAt: docData.updatedAt || Date.now(),
  };
}

export async function fetchCloudBookshelf(uid: string): Promise<BookshelfEntry[]> {
  const fb = ensureFirebase();
  if (!fb) return [];
  const colRef = collection(fb.db, 'users', uid, 'bookshelf');
  const snap = await getDocs(colRef);
  const items: BookshelfEntry[] = [];
  snap.forEach((d) => {
    const data = d.data() as CloudBookshelfDoc;
    if (data && data.seriesId) {
      items.push(fromCloudDoc(data));
    }
  });
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

export async function upsertCloudBookshelfEntry(uid: string, entry: BookshelfEntry): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  const docId = encodeSeriesDocId(entry.seriesKey);
  const ref = doc(fb.db, 'users', uid, 'bookshelf', docId);
  await setDoc(ref, toCloudDoc(entry), { merge: true });
}

export async function deleteCloudBookshelfEntry(uid: string, seriesKey: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  const docId = encodeSeriesDocId(seriesKey);
  const ref = doc(fb.db, 'users', uid, 'bookshelf', docId);
  await deleteDoc(ref);
}
