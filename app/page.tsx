'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Moon, Sun, BookOpen, Upload, Link2, RotateCcw,
  Timer, Download, Settings2, X, Check, AlertCircle, Loader2,
  List, Lock, ExternalLink, Zap, ClipboardPaste, BookMarked, ListOrdered,
  LogIn, LogOut, Menu
} from 'lucide-react';
import type { User } from 'firebase/auth';
import BookmarkletModal from '@/components/BookmarkletModal';
import PronunciationModal from '@/components/PronunciationModal';
import BookshelfModal from '@/components/BookshelfModal';
import AuthModal from '@/components/AuthModal';
import {
  subscribeAuth,
  signOutUser,
  fetchCloudBookshelf,
  upsertCloudBookshelfEntry,
  deleteCloudBookshelfEntry,
} from '@/lib/firebase';
import {
  splitIntoParagraphs,
  buildParagraphChunks,
  sanitizeNovelText,
  speedToRate,
  pitchToHz,
  estimateMinutes,
  applyPronunciationRules,
  detectSubChapters,
  PronunciationRule,
  SubChapterMarker,
} from '@/lib/textUtils';
import {
  saveSession,
  loadSession,
  clearSession,
  cacheChapter,
  getCachedChapter,
  deriveSeriesKey,
  saveToBookshelf,
  listBookshelf,
  deleteFromBookshelf,
  SessionData,
  CachedChapter,
  BookshelfEntry,
} from '@/lib/db';

type Theme = 'dark' | 'sepia' | 'light';
type FontFamily = 'sans' | 'serif' | 'mono';
type SleepTimerOption = 'none' | '15' | '30' | '60' | 'chapter';

const VOICES = [
  { id: 'vi-VN-HoaiMyNeural', label: 'Hoài My (Nữ)' },
  { id: 'vi-VN-NamMinhNeural', label: 'Nam Minh (Nam)' },
];

const SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const LOOKAHEAD = 2; // pre-fetch N chunks ahead
const AUTO_NEXT_THRESHOLD = 0.85; // at 85% trigger pre-fetch of next chapter

export default function AudiobookApp() {
  // --- UI State ---
  const [theme, setTheme] = useState<Theme>('dark');
  const [fontSize, setFontSize] = useState(18);
  const [fontFamily, setFontFamily] = useState<FontFamily>('serif');
  const [showSettings, setShowSettings] = useState(false);
  const [showBlacklist, setShowBlacklist] = useState(false);
  const [showBookmarklet, setShowBookmarklet] = useState(false);
  const [showPronunciation, setShowPronunciation] = useState(false);
  const [showBookshelf, setShowBookshelf] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const userRef = useRef<User | null>(null);
  const [oledSleepMode, setOledSleepMode] = useState(false);
  const [pronunciationRules, setPronunciationRules] = useState<PronunciationRule[]>([]);
  const pronunciationRulesRef = useRef<PronunciationRule[]>([]);
  const [bookshelfItems, setBookshelfItems] = useState<BookshelfEntry[]>([]);
  const [subChapters, setSubChapters] = useState<SubChapterMarker[]>([]);
  const [blacklistText, setBlacklistText] = useState('');
  const [inputMode, setInputMode] = useState<'url' | 'text'>('url');
  const [urlInput, setUrlInput] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [showPlaylist, setShowPlaylist] = useState(false);

  // --- Content State ---
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [prevUrl, setPrevUrl] = useState<string | null>(null);
  const [sourceDomain, setSourceDomain] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [lockedReason, setLockedReason] = useState<string | null>(null);
  const [chapterHistory, setChapterHistory] = useState<string[]>([]);
  const chapterCacheRef = useRef<Map<string, Omit<CachedChapter, 'cachedAt'>>>(new Map());
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [chunks, setChunks] = useState<string[]>([]);
  const [paragraphToChunkStart, setParagraphToChunkStart] = useState<number[]>([]);
  const [chunkToParagraph, setChunkToParagraph] = useState<number[]>([]);

  // Pre-fetched next chapter
  const nextChapterRef = useRef<{
    url: string;
    title: string;
    content: string;
    nextUrl: string | null;
    prevUrl: string | null;
    sourceDomain: string;
    locked?: boolean;
    reason?: string;
  } | null>(null);
  const prefetchTriggeredRef = useRef(false);

  // --- Playback State ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentChunk, setCurrentChunk] = useState(0);
  const [activeParagraph, setActiveParagraph] = useState<number>(-1);
  const [voice, setVoice] = useState('vi-VN-HoaiMyNeural');
  const [speed, setSpeed] = useState(1.0);
  const [pitch, setPitch] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [autoNext, setAutoNext] = useState(true);

  // Audio queue: blobURL per chunk index
  const blobCache = useRef<Map<number, string>>(new Map());
  const fetchingRef = useRef<Set<number>>(new Set());
  const retryCount = useRef<Map<number, number>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const currentChunkRef = useRef(0);
  const chunksRef = useRef<string[]>([]);
  const chunkToParagraphRef = useRef<number[]>([]);
  const hasTitleChunkRef = useRef(false);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackGenRef = useRef(0);
  const playChunkRef = useRef<(index: number, gen?: number) => void>(() => {});
  const persistNowRef = useRef<(overrideChunk?: number) => void>(() => {});
  const cloudSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Sleep Timer ---
  const [sleepTimer, setSleepTimer] = useState<SleepTimerOption>('none');
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Loading/Error State ---
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [clipboardImportReady, setClipboardImportReady] = useState(false);
  const [resumeBanner, setResumeBanner] = useState<{ session: SessionData; totalChunks: number } | null>(null);
  const [playlist, setPlaylist] = useState<{ title: string; url: string }[]>([]);

  // --- Refs for scrolling ---
  const paragraphRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);

  // ========== THEME MANAGEMENT ==========
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'sepia', 'light');
    root.classList.add(theme);
  }, [theme]);

  // ========== INDEXEDDB RESUME (Offer Resume Banner Without Auto-Loading URL) ==========
  useEffect(() => {
    loadSession().then((session) => {
      if (!session || !session.content) return;
      // Ignore any invalid 404 gate state
      if (
        session.title?.includes("404. That's an error.") ||
        session.content.includes('The requested URL was not found on this server.')
      ) {
        clearSession().catch(() => {});
        return;
      }

      const ago = Date.now() - session.savedAt;
      if (ago < 30 * 24 * 60 * 60 * 1000) {
        setResumeBanner({
          session,
          totalChunks: session.totalChunks || Math.max(1, session.chunkIndex + 1),
        });
      }
    });
  }, []);

  function restoreSavedSession(session: SessionData, startAtChunk: number) {
    setTitle(session.title.normalize('NFC'));
    setContent(session.content.normalize('NFC'));
    setNextUrl(session.nextUrl);
    setSourceDomain(session.sourceDomain || '');
    setUrlInput(session.url || '');
    setVoice(session.voice);
    setSpeed(session.rate);
    setPitch(session.pitch);
    setTheme(session.theme);
    setFontSize(session.fontSize);
    setFontFamily(session.fontFamily as FontFamily);
    setAutoNext(session.autoNext);
    setVolume(session.volume);

    processContent(session.content, startAtChunk, session.title);
    setResumeBanner(null);
    setTimeout(() => startPlayback(startAtChunk), 100);
  }

  function handleResumeFromSaved() {
    if (!resumeBanner) return;
    restoreSavedSession(resumeBanner.session, resumeBanner.session.chunkIndex);
  }

  function handleRestartChapter() {
    if (!resumeBanner) return;
    restoreSavedSession(resumeBanner.session, 0);
  }

  // Load pronunciation rules & bookshelf on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('audifox_pronunciation_rules');
      if (raw) {
        const parsed = JSON.parse(raw) as PronunciationRule[];
        if (Array.isArray(parsed)) {
          setPronunciationRules(parsed);
          pronunciationRulesRef.current = parsed;
        }
      }
    } catch {}
    listBookshelf().then(setBookshelfItems).catch(() => {});

    // Firebase Auth + Auto-Merge Local <-> Cloud Bookshelf
    const unsubscribe = subscribeAuth(async (authUser) => {
      setUser(authUser);
      userRef.current = authUser;
      if (!authUser) return;

      try {
        const [localItems, cloudItems] = await Promise.all([
          listBookshelf(),
          fetchCloudBookshelf(authUser.uid),
        ]);

        const merged = new Map<string, BookshelfEntry>();
        for (const item of localItems) merged.set(item.seriesKey, item);
        for (const cloudItem of cloudItems) {
          const existing = merged.get(cloudItem.seriesKey);
          if (!existing || cloudItem.updatedAt > existing.updatedAt) {
            merged.set(cloudItem.seriesKey, {
              ...cloudItem,
              content: existing?.url === cloudItem.url ? existing.content : cloudItem.content,
            });
          }
        }

        const mergedList = Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt);
        setBookshelfItems(mergedList);

        // Push newer local entries to Firestore and persist newer cloud entries to IndexedDB
        await Promise.all(
          mergedList.map(async (item) => {
            await saveToBookshelf(item).catch(() => {});
            const cloudMatch = cloudItems.find((c) => c.seriesKey === item.seriesKey);
            if (!cloudMatch || item.updatedAt > cloudMatch.updatedAt) {
              await upsertCloudBookshelfEntry(authUser.uid, item).catch(() => {});
            }
          })
        );
      } catch {}
    });

    return () => unsubscribe();
  }, []);

  function handleSavePronunciationRules(next: PronunciationRule[]) {
    setPronunciationRules(next);
    pronunciationRulesRef.current = next;
    blobCache.current.clear(); // clear cached TTS blobs so new rules apply immediately
    try {
      localStorage.setItem('audifox_pronunciation_rules', JSON.stringify(next));
    } catch {}
  }

  async function handleResumeBookshelf(entry: BookshelfEntry) {
    setShowBookshelf(false);
    setResumeBanner(null);
    hardResetAudio();
    setIsLocked(false);
    setLockedReason(null);
    setFetchError('');

    setVoice(entry.voice || 'vi-VN-HoaiMyNeural');
    setSpeed(entry.rate || 1.0);
    setPitch(entry.pitch ?? 0);

    // If synced from Firestore without local content, fetch chapter from URL and jump to saved chunk
    if (!entry.content && entry.url) {
      setUrlInput(entry.url);
      setIsFetching(true);
      try {
        const data = await getOrFetchChapter(entry.url);
        setTitle(data.title);
        setNextUrl(data.nextUrl);
        setPrevUrl(data.prevUrl);
        setSourceDomain(data.sourceDomain);
        if (data.locked) {
          setIsLocked(true);
          setLockedReason(data.reason || 'LOGIN_REQUIRED');
          return;
        }
        setContent(data.content);
        processContent(data.content, entry.chunkIndex, data.title);
        setTimeout(() => startPlayback(entry.chunkIndex), 80);
      } catch (err: unknown) {
        setFetchError(err instanceof Error ? err.message : 'Không thể tải chương từ tủ truyện');
      } finally {
        setIsFetching(false);
      }
      return;
    }

    setTitle(entry.chapterTitle.normalize('NFC'));
    setContent(entry.content.normalize('NFC'));
    setNextUrl(entry.nextUrl);
    setPrevUrl(entry.prevUrl);
    setSourceDomain(entry.sourceDomain || '');
    setUrlInput(entry.url || '');

    processContent(entry.content, entry.chunkIndex, entry.chapterTitle);
    setTimeout(() => startPlayback(entry.chunkIndex), 80);
  }

  async function handleDeleteBookshelf(seriesKey: string) {
    await deleteFromBookshelf(seriesKey).catch(() => {});
    if (userRef.current) {
      await deleteCloudBookshelfEntry(userRef.current.uid, seriesKey).catch(() => {});
    }
    listBookshelf().then(setBookshelfItems).catch(() => {});
  }

  // ========== CONTENT PROCESSING ==========
  function processContent(text: string, startChunk = 0, chapterTitle = ''): number {
    const blacklist = blacklistText.split('\n').filter(Boolean);
    const clean = sanitizeNovelText(text, blacklist);
    const newParagraphs = splitIntoParagraphs(clean);
    const {
      chunks: newChunks,
      paragraphToChunkStart: pToC,
      chunkToParagraph: cToP,
      hasTitleChunk,
    } = buildParagraphChunks(newParagraphs, 450, chapterTitle);

    const detectedSubs = detectSubChapters(newParagraphs, pToC);
    const clampedStart = Math.max(0, Math.min(startChunk, Math.max(0, newChunks.length - 1)));

    hasTitleChunkRef.current = hasTitleChunk;
    setParagraphs(newParagraphs);
    setSubChapters(detectedSubs);
    setChunks(newChunks);
    chunksRef.current = newChunks;
    setParagraphToChunkStart(pToC);
    setChunkToParagraph(cToP);
    chunkToParagraphRef.current = cToP;
    setCurrentChunk(clampedStart);
    currentChunkRef.current = clampedStart;
    setActiveParagraph(cToP[clampedStart] ?? -1);

    blobCache.current.clear();
    fetchingRef.current.clear();
    retryCount.current.clear();
    nextChapterRef.current = null;
    prefetchTriggeredRef.current = false;

    return newChunks.length;
  }

  // ========== SCRAPE API & CHAPTER CACHE ==========
  type ScrapeResponse = {
    title: string;
    content: string;
    nextUrl: string | null;
    prevUrl: string | null;
    sourceDomain: string;
    locked?: boolean;
    reason?: string;
  };

  async function fetchChapter(url: string): Promise<ScrapeResponse> {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function getOrFetchChapter(url: string): Promise<ScrapeResponse> {
    const memCached = chapterCacheRef.current.get(url);
    if (memCached) return { ...memCached, locked: false };

    try {
      const idbCached = await getCachedChapter(url);
      if (idbCached && Date.now() - idbCached.cachedAt < 24 * 60 * 60 * 1000) {
        chapterCacheRef.current.set(url, idbCached);
        return { ...idbCached, locked: false };
      }
    } catch {}

    const fresh = await fetchChapter(url);
    if (!fresh.locked && fresh.content) {
      const entry = { url, ...fresh };
      chapterCacheRef.current.set(url, entry);
      cacheChapter(entry).catch(() => {});
    }
    return fresh;
  }

  async function loadChapterByUrl(targetUrl: string, autoPlay = true, pushHistory = true) {
    const cleanUrl = targetUrl.trim();
    if (!cleanUrl) return;

    const currentUrl = urlInput.trim();
    if (pushHistory && currentUrl && currentUrl !== cleanUrl && (content || isLocked)) {
      setChapterHistory((prev) =>
        prev[prev.length - 1] === currentUrl ? prev : [...prev, currentUrl]
      );
    }

    setUrlInput(cleanUrl);
    setIsFetching(true);
    setFetchError('');
    setIsLocked(false);
    setLockedReason(null);
    stopPlayback();

    try {
      const data = await getOrFetchChapter(cleanUrl);
      setTitle(data.title);
      setNextUrl(data.nextUrl);
      setPrevUrl(data.prevUrl);
      setSourceDomain(data.sourceDomain);

      if (data.locked) {
        setContent('');
        setParagraphs([]);
        setChunks([]);
        chunksRef.current = [];
        setIsLocked(true);
        setLockedReason(data.reason || 'LOGIN_REQUIRED');
        setAutoNext(false);
        return;
      }

      setContent(data.content);
      processContent(data.content, 0, data.title);
      setPlaylist((prev) =>
        prev.some((p) => p.url === cleanUrl) ? prev : [...prev, { title: data.title, url: cleanUrl }]
      );

      if (autoPlay) {
        setTimeout(() => startPlayback(0), 50);
      }
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch chapter');
    } finally {
      setIsFetching(false);
    }
  }

  async function handleFetchAndPlay() {
    await loadChapterByUrl(urlInput, true, true);
  }

  async function handleNextChapter() {
    if (!nextUrl || isFetching) return;
    await loadChapterByUrl(nextUrl, isPlayingRef.current, true);
  }

  async function handlePrevChapter() {
    if (isFetching) return;
    const targetPrev = prevUrl || chapterHistory[chapterHistory.length - 1];
    if (!targetPrev) return;
    if (!prevUrl && chapterHistory.length > 0) {
      setChapterHistory((prev) => prev.slice(0, -1));
    }
    await loadChapterByUrl(targetPrev, isPlayingRef.current, false);
  }

  function hardResetAudio() {
    playbackGenRef.current += 1;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setAutoplayBlocked(false);
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    blobCache.current.forEach((url) => URL.revokeObjectURL(url));
    blobCache.current.clear();
    fetchingRef.current.clear();
    retryCount.current.clear();
    currentChunkRef.current = 0;
    setCurrentChunk(0);
  }

  function importAndPlayChapter(rawTitle: string, rawContent: string, sourceUrl = '') {
    hardResetAudio();
    setFetchError('');
    setIsLocked(false);
    setLockedReason(null);
    setResumeBanner(null);

    const cleanTitle = (rawTitle || 'Chương đã nhập').normalize('NFC').trim();
    const cleanBody = rawContent.normalize('NFC');
    let domain = '';
    if (sourceUrl) {
      try {
        domain = new URL(sourceUrl).hostname;
      } catch {}
    }

    setUrlInput(sourceUrl);
    setTitle(cleanTitle);
    setContent(cleanBody);
    setNextUrl(null);
    setPrevUrl(null);
    setSourceDomain(domain);
    processContent(cleanBody, 0, cleanTitle);

    setTimeout(() => startPlayback(0), 60);
  }

  const importChapterRef = useRef(importAndPlayChapter);
  importChapterRef.current = importAndPlayChapter;
  const postMessageReceivedRef = useRef(false);

  function parseClipboardPayload(raw: string): { title: string; content: string; sourceUrl: string } | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && parsed.__audifox === 1 && typeof parsed.content === 'string') {
          return {
            title: typeof parsed.title === 'string' ? parsed.title : '',
            content: parsed.content,
            sourceUrl: typeof parsed.sourceUrl === 'string' ? parsed.sourceUrl : '',
          };
        }
      } catch {}
    }
    const lines = trimmed.split(/\r?\n\r?\n/);
    const maybeTitle = lines.length > 1 && lines[0].length < 140 ? lines[0].trim() : 'Văn bản từ Clipboard';
    const body = lines.length > 1 && lines[0].length < 140 ? lines.slice(1).join('\n\n') : trimmed;
    return { title: maybeTitle, content: body, sourceUrl: '' };
  }

  // Cross-tab Bookmarklet receiver (postMessage + mobile clipboard fallback)
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || data.type !== 'AUDIFOX_IMPORT_CHAPTER' || typeof data.content !== 'string') {
        return;
      }

      postMessageReceivedRef.current = true;
      setClipboardImportReady(false);
      try {
        (event.source as Window | null)?.postMessage({ type: 'AUDIFOX_ACK' }, '*');
      } catch {}

      importChapterRef.current(
        typeof data.title === 'string' ? data.title : '',
        data.content,
        typeof data.sourceUrl === 'string' ? data.sourceUrl : ''
      );
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Mobile bookmarklet fallback: auto-read clipboard when ?from=bookmarklet&clip=1
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('from') !== 'bookmarklet' && params.get('clip') !== '1') return;

    const tryReadClipboard = async () => {
      if (postMessageReceivedRef.current) return;
      try {
        const raw = await navigator.clipboard.readText();
        const parsed = parseClipboardPayload(raw);
        if (parsed && parsed.content.length > 20) {
          setClipboardImportReady(false);
          window.history.replaceState({}, '', '/');
          importChapterRef.current(parsed.title, parsed.content, parsed.sourceUrl);
          return;
        }
      } catch {
        // Mobile Safari/Chrome may require a tap gesture to read clipboard
        if (!postMessageReceivedRef.current) {
          setClipboardImportReady(true);
        }
      }
    };

    const timer = setTimeout(tryReadClipboard, 450);
    const onFocus = () => {
      if (!postMessageReceivedRef.current) tryReadClipboard();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  async function handlePasteClipboardAndPlay() {
    try {
      const clip = await navigator.clipboard.readText();
      const parsed = parseClipboardPayload(clip);
      if (!parsed) {
        setFetchError('Clipboard trống — hãy copy nội dung chương trước.');
        return;
      }
      setClipboardImportReady(false);
      if (window.location.search.includes('bookmarklet')) {
        window.history.replaceState({}, '', '/');
      }
      importAndPlayChapter(parsed.title, parsed.content, parsed.sourceUrl);
    } catch {
      setFetchError('Trình duyệt chặn đọc Clipboard — hãy dùng tab Văn bản để dán thủ công.');
    }
  }

  function handlePasteText() {
    if (!pastedText.trim()) return;
    setTitle('Văn bản đã dán');
    setContent(pastedText);
    setNextUrl(null);
    processContent(pastedText);
    setTimeout(() => startPlayback(0), 100);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith('.txt')) {
      const text = await file.text();
      setTitle(file.name.replace('.txt', ''));
      setContent(text);
      setNextUrl(null);
      processContent(text);
      setTimeout(() => startPlayback(0), 100);
    } else if (file.name.endsWith('.epub')) {
      try {
        const { default: JSZip } = await import('jszip');
        const zip = await JSZip.loadAsync(file);
        const texts: string[] = [];

        // Extract text from HTML files in EPUB
        for (const filename of Object.keys(zip.files)) {
          if (filename.endsWith('.html') || filename.endsWith('.xhtml')) {
            const html = await zip.files[filename].async('string');
            // Strip tags
            const clean = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (clean.length > 100) texts.push(clean);
          }
        }

        const combined = texts.join('\n\n');
        setTitle(file.name.replace('.epub', ''));
        setContent(combined);
        setNextUrl(null);
        processContent(combined);
        setTimeout(() => startPlayback(0), 100);
      } catch {
        setFetchError('Failed to parse EPUB file');
      }
    }
  }

  // ========== TTS / AUDIO ENGINE ==========
  async function fetchAudioBlob(chunkIndex: number, chunkText: string): Promise<string> {
    if (blobCache.current.has(chunkIndex)) {
      return blobCache.current.get(chunkIndex)!;
    }
    if (fetchingRef.current.has(chunkIndex)) {
      // Wait for it
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          if (blobCache.current.has(chunkIndex)) {
            clearInterval(interval);
            resolve(blobCache.current.get(chunkIndex)!);
          }
        }, 100);
      });
    }

    fetchingRef.current.add(chunkIndex);
    const retries = retryCount.current.get(chunkIndex) || 0;

    try {
      const spokenText = applyPronunciationRules(chunkText, pronunciationRulesRef.current);
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: spokenText,
          voice,
          rate: speedToRate(speed),
          pitch: pitchToHz(pitch),
        }),
      });

      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      blobCache.current.set(chunkIndex, url);
      fetchingRef.current.delete(chunkIndex);
      return url;
    } catch (err) {
      fetchingRef.current.delete(chunkIndex);
      if (retries < 3) {
        retryCount.current.set(chunkIndex, retries + 1);
        await new Promise((r) => setTimeout(r, 500 * (retries + 1)));
        return fetchAudioBlob(chunkIndex, chunkText);
      }
      throw err;
    }
  }

  function prefetchChunks(fromIndex: number) {
    const c = chunksRef.current;
    for (let i = fromIndex; i < Math.min(fromIndex + LOOKAHEAD, c.length); i++) {
      if (!blobCache.current.has(i) && !fetchingRef.current.has(i)) {
        fetchAudioBlob(i, c[i]).catch(() => {}); // background, ignore errors
      }
    }
  }

  async function prefetchNextChapter() {
    if (!nextUrl || prefetchTriggeredRef.current || nextChapterRef.current) return;
    prefetchTriggeredRef.current = true;
    try {
      const target = nextUrl;
      const data = await getOrFetchChapter(target);
      nextChapterRef.current = { url: target, ...data };
    } catch {}
  }

  function waitForAudioReady(audio: HTMLAudioElement, gen: number): Promise<void> {
    if (audio.readyState >= 2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener('canplay', onReady);
        audio.removeEventListener('loadeddata', onReady);
        audio.removeEventListener('error', onError);
        clearTimeout(timer);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Audio failed to load'));
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, 5000);

      if (gen !== playbackGenRef.current) {
        cleanup();
        resolve();
        return;
      }
      audio.addEventListener('canplay', onReady);
      audio.addEventListener('loadeddata', onReady);
      audio.addEventListener('error', onError);
    });
  }

  async function playChunk(index: number, gen = playbackGenRef.current) {
    if (!isPlayingRef.current || gen !== playbackGenRef.current) return;
    const c = chunksRef.current;
    if (index >= c.length) {
      // Chapter finished
      if (autoNext && nextChapterRef.current) {
        loadNextChapter();
      } else if (autoNext && nextUrl) {
        // Wasn't pre-fetched yet
        await prefetchNextChapter();
        if (nextChapterRef.current) loadNextChapter();
        else {
          isPlayingRef.current = false;
          setIsPlaying(false);
        }
      } else {
        setIsPlaying(false);
        isPlayingRef.current = false;
      }
      return;
    }

    setCurrentChunk(index);
    currentChunkRef.current = index;
    persistNowRef.current(index);

    // Exact paragraph highlight & auto-scroll
    const pIdx = chunkToParagraphRef.current[index] ?? -1;
    setActiveParagraph(pIdx);
    if (autoScrollEnabled && pIdx >= 0 && paragraphRefs.current[pIdx]) {
      paragraphRefs.current[pIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Trigger pre-fetch for next chapter at 85%
    if (index / c.length >= AUTO_NEXT_THRESHOLD && autoNext) {
      prefetchNextChapter();
    }

    let blobUrl: string;
    try {
      blobUrl = await fetchAudioBlob(index, c[index]);
      prefetchChunks(index + 1);

      // 1.5s natural pause before reading the chapter title
      if (index === 0 && hasTitleChunkRef.current) {
        await new Promise<void>((resolve) => {
          pauseTimerRef.current = setTimeout(resolve, 1500);
        });
      }
    } catch {
      if (isPlayingRef.current && gen === playbackGenRef.current) {
        // Skip broken TTS chunk
        setTimeout(() => playChunkRef.current(index + 1, gen), 200);
      }
      return;
    }

    if (!isPlayingRef.current || gen !== playbackGenRef.current) return;

    const audio = audioRef.current;
    if (!audio) return;

    audio.src = blobUrl;
    audio.playbackRate = speed;
    audio.volume = volume;
    audio.load();

    try {
      await waitForAudioReady(audio, gen);
      if (!isPlayingRef.current || gen !== playbackGenRef.current) return;
      await audio.play();
      setAutoplayBlocked(false);
    } catch (playErr: unknown) {
      if (gen !== playbackGenRef.current) return;
      const errName = playErr instanceof DOMException ? playErr.name : '';
      const errMsg = playErr instanceof Error ? playErr.message : String(playErr);
      if (errName === 'NotAllowedError' || errMsg.includes('NotAllowedError')) {
        // Browser blocked autoplay without direct user gesture — reset cleanly & show 1-tap play banner
        playbackGenRef.current += 1;
        isPlayingRef.current = false;
        setIsPlaying(false);
        setAutoplayBlocked(true);
        return;
      }
      if (isPlayingRef.current && gen === playbackGenRef.current) {
        setTimeout(() => playChunkRef.current(index + 1, gen), 200);
      }
    }
  }

  playChunkRef.current = playChunk;

  function loadNextChapter() {
    const next = nextChapterRef.current;
    if (!next) return;

    const currentUrl = urlInput.trim();
    if (currentUrl && currentUrl !== next.url) {
      setChapterHistory((prev) => (prev[prev.length - 1] === currentUrl ? prev : [...prev, currentUrl]));
    }
    setUrlInput(next.url);
    setTitle(next.title);
    setNextUrl(next.nextUrl);
    setPrevUrl(next.prevUrl);
    setSourceDomain(next.sourceDomain);

    if (next.locked) {
      stopPlayback();
      setContent('');
      setParagraphs([]);
      setChunks([]);
      chunksRef.current = [];
      setIsLocked(true);
      setLockedReason(next.reason || 'LOGIN_REQUIRED');
      setAutoNext(false);
      return;
    }

    setIsLocked(false);
    setLockedReason(null);
    setContent(next.content);
    setPlaylist((prev) =>
      prev.some((p) => p.url === next.url) ? prev : [...prev, { title: next.title, url: next.url }]
    );
    processContent(next.content, 0, next.title);

    // Start playing after state settles
    setTimeout(() => {
      if (isPlayingRef.current) playChunkRef.current(0);
    }, 200);
  }

  function startPlayback(fromChunk = currentChunkRef.current) {
    const gen = ++playbackGenRef.current;
    setAutoplayBlocked(false);
    isPlayingRef.current = true;
    setIsPlaying(true);
    playChunk(fromChunk, gen);
    prefetchChunks(fromChunk);

    // Media Session API
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: sourceDomain });
      navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('nexttrack', () => skipNext());
    }
  }

  function stopPlayback() {
    playbackGenRef.current += 1;
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    persistNowRef.current(currentChunkRef.current);
  }

  function togglePlayPause() {
    if (isPlayingRef.current) {
      stopPlayback();
    } else {
      setResumeBanner(null);
      setAutoplayBlocked(false);
      startPlayback(currentChunkRef.current);
    }
  }

  function seekToChunk(targetChunk: number, autoPlay = isPlayingRef.current) {
    const gen = ++playbackGenRef.current;
    const clamped = Math.max(0, Math.min(targetChunk, Math.max(0, chunksRef.current.length - 1)));
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }

    setResumeBanner(null);
    setAutoplayBlocked(false);
    setCurrentChunk(clamped);
    currentChunkRef.current = clamped;
    const pIdx = chunkToParagraphRef.current[clamped] ?? -1;
    setActiveParagraph(pIdx);
    persistNowRef.current(clamped);

    if (autoPlay) {
      isPlayingRef.current = true;
      setIsPlaying(true);
      playChunkRef.current(clamped, gen);
      prefetchChunks(clamped);
    }
  }

  function skipNext() {
    const next = currentChunkRef.current + 1;
    if (next < chunksRef.current.length) {
      seekToChunk(next);
    }
  }

  function skipBack() {
    const prev = Math.max(0, currentChunkRef.current - 1);
    seekToChunk(prev);
  }

  function handleParagraphClick(pIdx: number) {
    const targetChunk = paragraphToChunkStart[pIdx] ?? 0;
    seekToChunk(targetChunk, true);
  }

  // Global PC Keyboard Shortcuts (ignoring inputs/textareas/selects)
  const shortcutHandlersRef = useRef({
    togglePlayPause,
    skipBack,
    skipNext,
    handlePrevChapter,
    handleNextChapter,
  });
  shortcutHandlersRef.current = {
    togglePlayPause,
    skipBack,
    skipNext,
    handlePrevChapter,
    handleNextChapter,
  };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (chunksRef.current.length === 0) return;

      if (e.code === 'Space') {
        e.preventDefault();
        shortcutHandlersRef.current.togglePlayPause();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) shortcutHandlersRef.current.handlePrevChapter();
        else shortcutHandlersRef.current.skipBack();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) shortcutHandlersRef.current.handleNextChapter();
        else shortcutHandlersRef.current.skipNext();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Audio element event: on ended → play next chunk
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    audio.addEventListener('ended', () => {
      const finishedIdx = currentChunkRef.current;
      // Revoke old blob
      const oldUrl = blobCache.current.get(finishedIdx);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      blobCache.current.delete(finishedIdx);

      if (isPlayingRef.current) {
        const gen = playbackGenRef.current;
        // 1.5s natural pause after reading the chapter title
        if (finishedIdx === 0 && hasTitleChunkRef.current) {
          pauseTimerRef.current = setTimeout(() => {
            if (isPlayingRef.current && gen === playbackGenRef.current) {
              playChunkRef.current(finishedIdx + 1, gen);
            }
          }, 1500);
        } else {
          playChunkRef.current(finishedIdx + 1, gen);
        }
      }
    });

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Keep audio volume/speed in sync
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.playbackRate = speed;
    }
  }, [volume, speed]);

  // ========== AUTO-SAVE SESSION & BOOKSHELF (Immediate + beforeunload) ==========
  const persistSession = useCallback(
    (overrideChunk?: number) => {
      if (!content) return;
      const chunkIdx = overrideChunk ?? currentChunkRef.current;
      const total = chunksRef.current.length;
      saveSession({
        url: urlInput,
        title,
        content,
        nextUrl,
        sourceDomain,
        chunkIndex: chunkIdx,
        totalChunks: total,
        voice,
        rate: speed,
        pitch,
        theme,
        fontSize,
        fontFamily,
        autoNext,
        volume,
      }).catch(() => {});

      const { seriesKey, seriesName } = deriveSeriesKey(urlInput, title);
      const entryData = {
        seriesKey,
        seriesName,
        url: urlInput,
        chapterTitle: title || 'Chương đã lưu',
        content,
        nextUrl,
        prevUrl,
        sourceDomain,
        chunkIndex: chunkIdx,
        totalChunks: total,
        voice,
        rate: speed,
        pitch,
      };
      saveToBookshelf(entryData)
        .then(() => listBookshelf().then(setBookshelfItems).catch(() => {}))
        .catch(() => {});

      if (userRef.current) {
        const uid = userRef.current.uid;
        if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
        cloudSyncTimerRef.current = setTimeout(() => {
          upsertCloudBookshelfEntry(uid, { ...entryData, updatedAt: Date.now() }).catch(() => {});
        }, 1200);
      }
    },
    [urlInput, title, content, nextUrl, prevUrl, sourceDomain, voice, speed, pitch, theme, fontSize, fontFamily, autoNext, volume]
  );

  persistNowRef.current = persistSession;

  useEffect(() => {
    persistSession(currentChunk);
  }, [currentChunk, persistSession]);

  useEffect(() => {
    const handleFlush = () => persistNowRef.current(currentChunkRef.current);
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') handleFlush();
    };
    window.addEventListener('beforeunload', handleFlush);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('beforeunload', handleFlush);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // ========== SLEEP TIMER ==========
  function setSleep(opt: SleepTimerOption) {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    setSleepTimer(opt);
    if (opt === 'none') return;
    if (opt === 'chapter') {
      // Will stop at end naturally when no next chapter
      setAutoNext(false);
      return;
    }
    const mins = parseInt(opt);
    sleepTimerRef.current = setTimeout(() => {
      stopPlayback();
      setSleepTimer('none');
    }, mins * 60 * 1000);
  }

  // ========== MP3 EXPORT ==========
  async function exportMp3() {
    const blobs: Blob[] = [];
    const c = chunksRef.current;
    for (let i = 0; i < c.length; i++) {
      const url = blobCache.current.get(i);
      if (url) {
        const res = await fetch(url);
        blobs.push(await res.blob());
      } else {
        try {
          const blobUrl = await fetchAudioBlob(i, c[i]);
          const res = await fetch(blobUrl);
          blobs.push(await res.blob());
        } catch {}
      }
    }

    const combined = new Blob(blobs, { type: 'audio/mpeg' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(combined);
    a.download = `${title || 'chapter'}.mp3`;
    a.click();
  }

  // ========== COMPUTED ==========
  const progress = chunks.length > 0 ? currentChunk / chunks.length : 0;
  const totalChars = chunks.reduce((s, c) => s + c.length, 0);
  const doneChars = chunks.slice(0, currentChunk).reduce((s, c) => s + c.length, 0);
  const estLeft = estimateMinutes(totalChars - doneChars, speed);

  const themeClasses: Record<Theme, string> = {
    dark: 'bg-[#0E101A] text-[#F3F4F6]',
    sepia: 'bg-amber-50 text-amber-900',
    light: 'bg-white text-gray-900',
  };

  const panelClasses: Record<Theme, string> = {
    dark: 'bg-[#222434] border-white/10',
    sepia: 'bg-amber-100 border-amber-300',
    light: 'bg-gray-50 border-gray-200',
  };

  const fontFamilyMap: Record<FontFamily, string> = {
    sans: 'font-sans',
    serif: 'font-serif',
    mono: 'font-mono',
  };

  return (
    <div className={`min-h-screen overflow-x-hidden ${themeClasses[theme]} transition-colors duration-300`}>
      {/* Hidden audio element managed by ref */}

      {/* ===== RESUME BANNER ===== */}
      {resumeBanner && (
        <div className={`sticky top-0 z-50 border-b px-4 py-2.5 ${theme === 'dark' ? 'bg-indigo-950/95 border-indigo-800 text-indigo-100' : theme === 'sepia' ? 'bg-amber-200 border-amber-400 text-amber-950' : 'bg-indigo-50 border-indigo-200 text-indigo-950'} text-sm`}>
          <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <span>
              📖 Phiên đọc gần nhất: <strong>{(resumeBanner.session.title || 'Chương đã lưu').normalize('NFC')}</strong> · Đoạn{' '}
              <strong>{resumeBanner.session.chunkIndex + 1}</strong> / {resumeBanner.totalChunks}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleResumeFromSaved}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 transition-colors"
              >
                <Play size={12} /> Tiếp tục từ đoạn {resumeBanner.session.chunkIndex + 1}
              </button>
              <button
                onClick={handleRestartChapter}
                className="px-2.5 py-1 rounded-full border border-current/25 text-xs font-medium hover:bg-black/10 flex items-center gap-1"
              >
                <RotateCcw size={12} /> Đọc lại từ đầu
              </button>
              <button onClick={() => setResumeBanner(null)} className="opacity-70 hover:opacity-100 p-1" title="Đóng">
                <X size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TOP BAR ===== */}
      <header className={`sticky top-0 z-40 border-b ${panelClasses[theme]} player-bar`}>
        <div className="max-w-5xl mx-auto px-3 sm:px-5 py-3">
          {/* Row 1: Fox Logo + Desktop Menu + Account */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 mb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  onClick={() => setShowMobileMenu((v) => !v)}
                  className={`sm:hidden p-2 rounded-xl border ${panelClasses[theme]} shrink-0`}
                  aria-label="Menu"
                >
                  {showMobileMenu ? <X size={18} /> : <Menu size={18} />}
                </button>
                <img
                  src="/logo.png"
                  alt="Audifox"
                  className="w-7 h-7 rounded-lg object-contain shrink-0"
                />
                <span className="font-bold text-lg tracking-tight">Audifox</span>
                {title && (
                  <span className={`hidden lg:inline text-xs truncate max-w-[200px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    — {title}
                  </span>
                )}
              </div>

              {/* Mobile quick actions right side of logo row */}
              <div className="flex sm:hidden items-center gap-1.5">
                <button
                  onClick={() => setShowBookshelf(true)}
                  className={`px-2.5 py-1.5 rounded-xl border ${panelClasses[theme]} text-xs font-medium flex items-center gap-1`}
                  title="Tủ truyện"
                >
                  <BookMarked size={14} className="text-[#8B5CF6]" />
                  {bookshelfItems.length > 0 && (
                    <span className="px-1.5 rounded-full bg-[#8B5CF6] text-white text-[10px]">
                      {bookshelfItems.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className={`p-2 rounded-xl border ${panelClasses[theme]}`}
                  title="Cài đặt"
                >
                  <Settings2 size={16} />
                </button>
              </div>
            </div>

            {/* Desktop Menu Items + Account */}
            <div className="flex items-center justify-between sm:justify-end gap-2 flex-wrap">
              <div className="hidden sm:flex items-center gap-1.5">
                <button
                  onClick={() => setShowBookshelf(true)}
                  className={`px-3 py-1.5 rounded-xl ${panelClasses[theme]} border text-xs font-medium flex items-center gap-1.5 hover:border-[#8B5CF6]/60 transition-colors`}
                  title="Tủ truyện"
                >
                  <BookMarked size={14} className="text-[#8B5CF6]" />
                  <span>Tủ truyện</span>
                  {bookshelfItems.length > 0 && (
                    <span className="px-1.5 rounded-full bg-[#8B5CF6] text-white text-[10px] leading-4">
                      {bookshelfItems.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setShowBookmarklet(true)}
                  className={`px-3 py-1.5 rounded-xl ${panelClasses[theme]} border text-xs font-medium flex items-center gap-1.5 hover:border-amber-400/60 transition-colors`}
                  title="Nút đọc 1-Click (Bookmarklet)"
                >
                  <Zap size={14} className="text-amber-400" />
                  <span>Nút đọc 1-Click</span>
                </button>
                <button
                  onClick={handlePasteClipboardAndPlay}
                  className={`px-3 py-1.5 rounded-xl ${panelClasses[theme]} border text-xs font-medium flex items-center gap-1.5 hover:border-[#8B5CF6]/60 transition-colors`}
                  title="Dán & Phát ngay"
                >
                  <ClipboardPaste size={14} className="text-[#A78BFA]" />
                  <span>Dán & Phát ngay</span>
                </button>
                {chunks.length > 0 && (
                  <button
                    onClick={() => setOledSleepMode(true)}
                    className={`px-3 py-1.5 rounded-xl ${panelClasses[theme]} border text-xs font-medium flex items-center gap-1.5 hover:border-[#8B5CF6]/60 transition-colors`}
                    title="Chế độ ngủ (OLED)"
                  >
                    <Moon size={14} className="text-[#A78BFA]" />
                    <span className="hidden md:inline">Chế độ ngủ (OLED)</span>
                  </button>
                )}
                <button
                  onClick={() => setTheme(t => t === 'dark' ? 'sepia' : t === 'sepia' ? 'light' : 'dark')}
                  className={`p-2 rounded-xl ${panelClasses[theme]} border`}
                  title="Đổi theme"
                >
                  {theme === 'dark' ? <Moon size={15} /> : theme === 'sepia' ? <BookOpen size={15} /> : <Sun size={15} />}
                </button>
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className={`p-2 rounded-xl ${panelClasses[theme]} border`}
                  title="Cài đặt"
                >
                  <Settings2 size={15} />
                </button>
                {playlist.length > 0 && (
                  <button
                    onClick={() => setShowPlaylist(!showPlaylist)}
                    className={`p-2 rounded-xl ${panelClasses[theme]} border`}
                    title="Danh sách chương"
                  >
                    <List size={15} />
                  </button>
                )}
              </div>

              {/* Account Section (Refined Avatar + Sync Badge / Pill Login) */}
              {user ? (
                <div className={`w-full sm:w-auto min-h-[40px] flex items-center justify-between sm:justify-start gap-2 px-3 py-1.5 rounded-full border text-xs ${panelClasses[theme]}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="" className="w-5 h-5 rounded-full shrink-0 object-cover" />
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#7C5DFA] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {(user.displayName || user.email || 'U')[0].toUpperCase()}
                      </span>
                    )}
                    <span className="truncate max-w-[180px] sm:max-w-[170px] text-[#F3F4F6] font-medium tracking-tight">
                      {user.displayName || user.email}
                      <span className="text-[#34D399] font-normal"> • ✓ Đã đồng bộ</span>
                    </span>
                  </div>
                  <button
                    onClick={() => signOutUser()}
                    className="px-2 py-1 rounded-full hover:bg-red-500/15 text-[#9CA3AF] hover:text-red-400 text-[11px] font-medium inline-flex items-center gap-1 shrink-0"
                    title="Đăng xuất"
                  >
                    <LogOut size={11} />
                    <span>Đăng xuất</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="w-full sm:w-auto min-h-[40px] px-4 py-1.5 rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#7C5DFA] hover:opacity-95 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-opacity shadow-md shrink-0"
                  title="Đăng nhập"
                >
                  <LogIn size={13} />
                  <span>Đăng nhập</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile Hamburger Drawer */}
          {showMobileMenu && (
            <div className={`sm:hidden mb-3 p-2.5 rounded-2xl border grid grid-cols-2 gap-2 ${panelClasses[theme]}`}>
              <button
                onClick={() => { setShowMobileMenu(false); setShowBookmarklet(true); }}
                className="px-3 py-2 rounded-xl border border-current/15 text-xs font-medium flex items-center gap-1.5"
              >
                <Zap size={14} className="text-amber-400 shrink-0" /> Nút đọc 1-Click
              </button>
              <button
                onClick={() => { setShowMobileMenu(false); handlePasteClipboardAndPlay(); }}
                className="px-3 py-2 rounded-xl border border-current/15 text-xs font-medium flex items-center gap-1.5"
              >
                <ClipboardPaste size={14} className="text-[#A78BFA] shrink-0" /> Dán & Phát ngay
              </button>
              <button
                onClick={() => { setShowMobileMenu(false); setShowPronunciation(true); }}
                className="px-3 py-2 rounded-xl border border-current/15 text-xs font-medium flex items-center gap-1.5"
              >
                🗣 Từ điển phát âm
              </button>
              <button
                onClick={() => setTheme(t => t === 'dark' ? 'sepia' : t === 'sepia' ? 'light' : 'dark')}
                className="px-3 py-2 rounded-xl border border-current/15 text-xs font-medium flex items-center gap-1.5"
              >
                {theme === 'dark' ? <Moon size={14} /> : theme === 'sepia' ? <BookOpen size={14} /> : <Sun size={14} />}
                Theme: {theme === 'dark' ? 'Tối' : theme === 'sepia' ? 'Sepia' : 'Sáng'}
              </button>
              {chunks.length > 0 && (
                <button
                  onClick={() => { setShowMobileMenu(false); setOledSleepMode(true); }}
                  className="col-span-2 px-3 py-2 rounded-xl border border-[#8B5CF6]/40 bg-[#8B5CF6]/10 text-xs font-medium flex items-center justify-center gap-1.5"
                >
                  <Moon size={14} className="text-[#A78BFA]" /> Chế độ ngủ (OLED)
                </button>
              )}
            </div>
          )}

          {/* Input Mode Tabs */}
          <div className="flex gap-1 mb-3">
            <button onClick={() => setInputMode('url')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${inputMode === 'url' ? 'bg-indigo-600 text-white' : (theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900')}`}>
              <Link2 size={14} className="inline mr-1" />URL
            </button>
            <button onClick={() => setInputMode('text')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${inputMode === 'text' ? 'bg-indigo-600 text-white' : (theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900')}`}>
              <Upload size={14} className="inline mr-1" />Văn bản
            </button>
          </div>

          {/* URL Input */}
          {inputMode === 'url' && (
            <div className="flex flex-wrap sm:flex-nowrap gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchAndPlay()}
                placeholder="Dán URL chương truyện... (vd: truyenfull.vn/truyen/chuong-1)"
                className={`min-w-0 flex-1 basis-full sm:basis-auto px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500' : theme === 'sepia' ? 'bg-amber-50 border-amber-300 text-amber-900 placeholder-amber-400' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`}
              />
              <button
                onClick={handleFetchAndPlay}
                disabled={isFetching || !urlInput.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
                {isFetching ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {isFetching ? 'Đang tải...' : 'Phát'}
              </button>
              {(prevUrl || chapterHistory.length > 0) && (
                <button
                  onClick={handlePrevChapter}
                  disabled={isFetching}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${panelClasses[theme]} disabled:opacity-50 flex items-center gap-1 transition-colors`}
                  title="Chương trước"
                >
                  <SkipBack size={16} />
                  Trước
                </button>
              )}
              {nextUrl && (
                <button
                  onClick={handleNextChapter}
                  disabled={isFetching}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${panelClasses[theme]} disabled:opacity-50 flex items-center gap-1 transition-colors`}
                  title="Chương tiếp theo"
                >
                  <SkipForward size={16} />
                  Tiếp
                </button>
              )}
            </div>
          )}

          {/* Text/File Input */}
          {inputMode === 'text' && (
            <div className="space-y-2">
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Dán văn bản truyện vào đây..."
                rows={3}
                className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500' : theme === 'sepia' ? 'bg-amber-50 border-amber-300 text-amber-900 placeholder-amber-400' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`}
              />
              <div className="flex gap-2">
                <button onClick={handlePasteText} disabled={!pastedText.trim()}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-1">
                  <Play size={14} /> Phát văn bản
                </button>
                <label className={`px-3 py-1.5 rounded-lg border ${panelClasses[theme]} text-sm cursor-pointer flex items-center gap-1`}>
                  <Upload size={14} /> Tải file (.txt/.epub)
                  <input type="file" accept=".txt,.epub" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
            </div>
          )}

          {/* Error */}
          {fetchError && (
            <div className="mt-2 flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle size={14} />
              {fetchError}
            </div>
          )}

          {/* Mobile Bookmarklet Clipboard Tap Prompt */}
          {clipboardImportReady && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-indigo-600/20 border border-indigo-500/40 px-3 py-2 text-xs sm:text-sm">
              <span>Đã nhận chương từ Bookmarklet — chạm để đọc ngay:</span>
              <button
                onClick={handlePasteClipboardAndPlay}
                className="px-3 py-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shrink-0 flex items-center gap-1"
              >
                <ClipboardPaste size={13} /> Dán & Phát ngay
              </button>
            </div>
          )}

          {/* Autoplay Blocked One-Tap Banner */}
          {autoplayBlocked && chunks.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-500/15 border border-amber-500/40 px-3 py-2 text-xs sm:text-sm">
              <span>Trình duyệt chặn tự động phát khi chuyển tab.</span>
              <button
                onClick={() => startPlayback(currentChunkRef.current)}
                className="px-3.5 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shrink-0 flex items-center gap-1.5 shadow"
              >
                <Volume2 size={14} /> Nhấn để bắt đầu nghe chương mới
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ===== SETTINGS PANEL ===== */}
      {showSettings && (
        <div className={`border-b ${panelClasses[theme]}`}>
          <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap gap-3 sm:gap-4 items-center">
            {/* Font size */}
            <div className="flex items-center gap-2 text-sm">
              <span className="opacity-60">Cỡ chữ</span>
              <button onClick={() => setFontSize(s => Math.max(13, s - 1))} className="px-2 py-0.5 rounded border text-xs">−</button>
              <span>{fontSize}px</span>
              <button onClick={() => setFontSize(s => Math.min(28, s + 1))} className="px-2 py-0.5 rounded border text-xs">+</button>
            </div>
            {/* Font family */}
            <div className="flex items-center gap-2 text-sm">
              <span className="opacity-60">Font</span>
              {(['sans', 'serif', 'mono'] as FontFamily[]).map(f => (
                <button key={f} onClick={() => setFontFamily(f)}
                  className={`px-2 py-0.5 rounded border text-xs ${fontFamily === f ? 'bg-indigo-600 text-white border-indigo-600' : ''}`}>
                  {f === 'sans' ? 'Sans' : f === 'serif' ? 'Serif' : 'Mono'}
                </button>
              ))}
            </div>
            {/* Auto scroll */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={autoScrollEnabled} onChange={e => setAutoScrollEnabled(e.target.checked)} />
              <span className="opacity-80">Cuộn tự động</span>
            </label>
            {/* Blacklist */}
            <button onClick={() => setShowBlacklist(true)}
              className={`px-3 py-1 rounded border ${panelClasses[theme]} text-sm`}>
              🚫 Danh sách đen
            </button>
            {/* Pronunciation Dictionary */}
            <button onClick={() => setShowPronunciation(true)}
              className={`px-3 py-1 rounded border ${panelClasses[theme]} text-sm flex items-center gap-1.5`}>
              🗣 Từ điển phát âm
              {pronunciationRules.length > 0 && (
                <span className="px-1.5 rounded-full bg-indigo-600 text-white text-xs">{pronunciationRules.length}</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ===== BLACKLIST MODAL ===== */}
      {showBlacklist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4">
          <div className={`w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl p-4 sm:p-6 shadow-2xl border ${theme === 'dark' ? 'bg-[#11131C] border-white/10 text-gray-100' : theme === 'sepia' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-gray-200 text-gray-900'}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold">Danh sách đen (watermarks, từ cần lọc)</h3>
              <button onClick={() => setShowBlacklist(false)}><X size={18} /></button>
            </div>
            <p className="text-sm opacity-60 mb-2">Mỗi dòng một từ/regex. Hỗ trợ regex (vd: truyenfull\.vn)</p>
            <textarea
              value={blacklistText}
              onChange={e => setBlacklistText(e.target.value)}
              placeholder={'truyenfull.vn\nwattpad.com\ntangthuvien'}
              rows={8}
              className={`w-full px-3 py-2 rounded-lg border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setShowBlacklist(false)}
                className="px-4 py-2 rounded-lg border text-sm">Đóng</button>
              <button onClick={() => { setShowBlacklist(false); if (content) processContent(content); }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm flex items-center gap-1">
                <Check size={14} /> Áp dụng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MAIN CONTENT ===== */}
      <main className={`max-w-3xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 ${chunks.length > 0 ? 'pb-56 sm:pb-44' : 'pb-16'}`}>
        {/* Playlist sidebar */}
        {showPlaylist && playlist.length > 0 && (
          <div className={`mb-6 p-4 rounded-xl border ${panelClasses[theme]}`}>
            <h3 className="font-semibold mb-2 text-sm">📋 Danh sách chương đã đọc</h3>
            <ul className="space-y-1">
              {playlist.map((item, idx) => (
                <li key={idx} className="text-sm flex items-center gap-2">
                  <span className="opacity-40">{idx + 1}.</span>
                  <button onClick={() => loadChapterByUrl(item.url, true, true)}
                    className="hover:text-indigo-500 text-left truncate">{item.title || item.url}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Chapter title */}
        {title && (
          <div className="mb-6 sm:mb-8 pb-4 border-b border-current/10 flex flex-wrap sm:flex-nowrap items-start justify-between gap-3">
            <h1
              onClick={() => seekToChunk(0, true)}
              className={`min-w-0 flex-1 break-words font-bold leading-snug cursor-pointer rounded-lg transition-colors ${fontFamilyMap[fontFamily]} ${
                activeParagraph === -1 && currentChunk === 0 && isPlaying
                  ? 'text-indigo-400'
                  : ''
              }`}
              style={{ fontSize: `${fontSize + 6}px` }}
              title="Nhấn để đọc từ tiêu đề"
            >
              {title.normalize('NFC')}
            </h1>
            <div className="flex items-center gap-1 shrink-0 text-xs">
              <button
                onClick={() => setFontSize((s) => Math.max(14, s - 1))}
                className={`px-2 py-1 rounded border ${panelClasses[theme]}`}
                title="Giảm cỡ chữ"
              >
                A−
              </button>
              <button
                onClick={() => setFontSize((s) => Math.min(28, s + 1))}
                className={`px-2 py-1 rounded border ${panelClasses[theme]}`}
                title="Tăng cỡ chữ"
              >
                A+
              </button>
            </div>
          </div>
        )}

        {/* Bundled Sub-Chapter Quick-Jump Markers */}
        {!isLocked && subChapters.length >= 2 && (
          <div className={`mb-6 p-3 rounded-xl border ${panelClasses[theme]}`}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold flex items-center gap-1.5 opacity-80">
                <ListOrdered size={14} className="text-indigo-400" />
                Mục lục nhanh ({subChapters.length} phần)
              </span>
              <select
                value=""
                onChange={(e) => {
                  const idx = parseInt(e.target.value, 10);
                  if (!Number.isNaN(idx)) seekToChunk(idx, true);
                }}
                className={`text-xs rounded-lg border px-2 py-1 max-w-[180px] ${
                  theme === 'dark'
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : theme === 'sepia'
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-white border-gray-300 text-gray-900'
                }`}
              >
                <option value="">Nhảy tới...</option>
                {subChapters.map((sc, i) => (
                  <option key={i} value={sc.chunkIndex}>
                    {sc.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {subChapters.map((sc, i) => (
                <button
                  key={i}
                  onClick={() => seekToChunk(sc.chunkIndex, true)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    activeParagraph >= sc.paragraphIndex &&
                    (i === subChapters.length - 1 || activeParagraph < subChapters[i + 1].paragraphIndex)
                      ? 'bg-indigo-600 border-indigo-600 text-white font-medium'
                      : 'border-current/20 hover:border-indigo-400 hover:text-indigo-400'
                  }`}
                >
                  {sc.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Locked / Login Required State */}
        {isLocked ? (
          <div className={`rounded-2xl border p-8 text-center space-y-4 ${panelClasses[theme]}`}>
            <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center">
              <Lock size={24} />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-bold">Chương này đang bị khóa</h2>
              <p className="text-sm opacity-75 max-w-md mx-auto">
                {lockedReason === 'LOGIN_REQUIRED'
                  ? `Trang ${sourceDomain || 'nguồn'} yêu cầu đăng nhập tài khoản để đọc chương này. Tự động chuyển chương đã được tạm dừng.`
                  : 'Không thể trích xuất nội dung chương này.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              {urlInput && (
                <a
                  href={urlInput}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
                >
                  <ExternalLink size={15} /> Mở trang gốc để đăng nhập
                </a>
              )}
              <button
                onClick={() => setShowBookmarklet(true)}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <Zap size={15} /> Nút đọc 1-Click (Bookmarklet)
              </button>
              <button
                onClick={handlePasteClipboardAndPlay}
                className={`px-4 py-2 rounded-lg border text-sm font-medium ${panelClasses[theme]} inline-flex items-center gap-1.5`}
              >
                <ClipboardPaste size={15} /> Dán & Phát ngay
              </button>
              {urlInput && (
                <button
                  onClick={() => loadChapterByUrl(urlInput, false, false)}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium ${panelClasses[theme]} inline-flex items-center gap-1`}
                >
                  <RotateCcw size={14} /> Thử lại
                </button>
              )}
            </div>
          </div>
        ) : paragraphs.length > 0 ? (
          <article
            ref={contentRef}
            className={`max-w-[72ch] mx-auto space-y-5 leading-[1.85] ${fontFamilyMap[fontFamily]}`}
            style={{ fontSize: `${fontSize}px` }}
          >
            {paragraphs.map((para, idx) => {
              const isActive = idx === activeParagraph;
              return (
                <p
                  key={idx}
                  ref={(el) => { paragraphRefs.current[idx] = el; }}
                  onClick={() => handleParagraphClick(idx)}
                  className={`group relative cursor-pointer break-words rounded-lg px-3 sm:px-3.5 py-2.5 border-l-2 transition-all duration-200 ${
                    isActive
                      ? theme === 'dark'
                        ? 'border-indigo-400 bg-indigo-500/15 text-indigo-100 shadow-sm'
                        : theme === 'sepia'
                          ? 'border-amber-700 bg-amber-900/10 text-amber-950 shadow-sm'
                          : 'border-indigo-600 bg-indigo-50 text-indigo-950 shadow-sm'
                      : 'border-transparent hover:border-indigo-400/40 hover:bg-gray-500/10'
                  }`}
                >
                  {para.normalize('NFC')}
                  <span className="ml-2 inline-block text-[11px] font-sans font-medium opacity-0 group-hover:opacity-70 text-indigo-400 transition-opacity select-none">
                    ▶ Đọc từ đoạn này
                  </span>
                </p>
              );
            })}
          </article>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 opacity-30">
            <BookOpen size={64} className="mb-4" />
            <p className="text-lg">Dán URL hoặc văn bản để bắt đầu nghe sách</p>
            <p className="text-sm mt-1">Hỗ trợ hầu hết các trang truyện tiếng Việt</p>
          </div>
        )}
      </main>

      {/* ===== BOTTOM PLAYER BAR ===== */}
      {chunks.length > 0 && (
        <div
          className={`fixed bottom-0 inset-x-0 z-40 border-t ${
            theme === 'dark' ? 'bg-[#1B1D2B]/95 border-white/10' : panelClasses[theme]
          } player-bar pb-[env(safe-area-inset-bottom)]`}
        >
          <div className="max-w-4xl mx-auto px-3 sm:px-5 pt-2.5 pb-2.5 space-y-2.5">
            {/* Centered Chapter Title */}
            {title && (
              <div className="text-center text-xs sm:text-sm font-medium text-[#F3F4F6] truncate px-2">
                {title.normalize('NFC')}
              </div>
            )}

            {/* Smooth Violet Progress Slider */}
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] font-medium tabular-nums text-[#9CA3AF] whitespace-nowrap">
                {currentChunk + 1}/{chunks.length}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0, chunks.length - 1)}
                value={currentChunk}
                onChange={(e) => seekToChunk(parseInt(e.target.value, 10))}
                aria-label="Tua tiến độ đọc"
                className="min-w-0 flex-1 h-1.5 accent-[#8B5CF6] cursor-pointer"
              />
              <span className="text-[11px] font-semibold tabular-nums text-[#8B5CF6] whitespace-nowrap">
                {Math.round(((currentChunk + 1) / chunks.length) * 100)}% • ~{estLeft}p
              </span>
            </div>

            {/* Centered Transport Row */}
            <div className="flex items-center justify-center gap-3 sm:gap-5 py-0.5">
              <button
                onClick={() => seekToChunk(currentChunkRef.current - 3)}
                className="min-h-[40px] px-2.5 py-1.5 rounded-full border border-white/10 text-xs font-semibold text-[#9CA3AF] hover:border-[#8B5CF6]/60 hover:text-[#F3F4F6] transition-colors shrink-0"
                title="Lùi 3 đoạn"
              >
                −3
              </button>
              <button
                onClick={skipBack}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full hover:bg-white/10 transition-colors shrink-0"
                aria-label="Đoạn trước"
              >
                <SkipBack size={20} />
              </button>
              <button
                onClick={togglePlayPause}
                className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#7C5DFA] hover:scale-105 text-white flex items-center justify-center transition-transform shadow-[0_0_20px_rgba(139,92,246,0.4)] shrink-0"
                aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}
              >
                {isPlaying ? <Pause size={22} /> : <Play size={22} className="ml-0.5" />}
              </button>
              <button
                onClick={skipNext}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full hover:bg-white/10 transition-colors shrink-0"
                aria-label="Đoạn tiếp"
              >
                <SkipForward size={20} />
              </button>
              <button
                onClick={() => seekToChunk(currentChunkRef.current + 3)}
                className="min-h-[40px] px-2.5 py-1.5 rounded-full border border-white/10 text-xs font-semibold text-[#9CA3AF] hover:border-[#8B5CF6]/60 hover:text-[#F3F4F6] transition-colors shrink-0"
                title="Tiến 3 đoạn"
              >
                +3
              </button>
            </div>

            {/* Compact Secondary Row */}
            <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-current/10">
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={voice}
                  onChange={e => setVoice(e.target.value)}
                  className={`min-w-0 max-w-[130px] sm:max-w-none text-xs rounded-lg border px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#8B5CF6] ${theme === 'dark' ? 'bg-[#252525] border-white/10 text-white' : theme === 'sepia' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-gray-300 text-gray-900'}`}
                >
                  {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>

                <select
                  value={speed}
                  onChange={e => setSpeed(parseFloat(e.target.value))}
                  className={`text-xs rounded-lg border px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#8B5CF6] ${theme === 'dark' ? 'bg-[#252525] border-white/10 text-white' : theme === 'sepia' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-gray-300 text-gray-900'}`}
                >
                  {SPEED_OPTIONS.map(s => <option key={s} value={s}>{s}x</option>)}
                </select>

                <div className="flex items-center gap-1.5">
                  <button onClick={() => setVolume(v => v > 0 ? 0 : 0.9)} className="p-1">
                    {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={e => setVolume(parseFloat(e.target.value))}
                    className="w-16 sm:w-20 accent-[#8B5CF6]"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <div
                    className={`w-8 h-4 rounded-full relative transition-colors ${autoNext ? 'bg-[#8B5CF6]' : 'bg-gray-600'}`}
                    onClick={() => setAutoNext(a => !a)}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${autoNext ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                  <span className="hidden sm:inline">Tự chuyển</span>
                </label>

                <div className="flex items-center gap-1 text-xs">
                  <Timer size={13} className="opacity-60" />
                  <select
                    value={sleepTimer}
                    onChange={e => setSleep(e.target.value as SleepTimerOption)}
                    className={`text-xs rounded-lg border px-1.5 py-1 focus:outline-none ${theme === 'dark' ? 'bg-[#252525] border-white/10 text-white' : theme === 'sepia' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-gray-300 text-gray-900'}`}
                  >
                    <option value="none">Hẹn giờ</option>
                    <option value="15">15p</option>
                    <option value="30">30p</option>
                    <option value="60">60p</option>
                    <option value="chapter">Hết chương</option>
                  </select>
                </div>

                <button
                  onClick={() => setShowPronunciation(true)}
                  className={`text-xs px-2.5 py-1 rounded-lg border ${panelClasses[theme]} hover:border-[#8B5CF6]/60`}
                  title="Từ điển phát âm"
                >
                  🗣 Từ điển
                </button>

                <button
                  onClick={exportMp3}
                  title="Xuất MP3"
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border ${panelClasses[theme]} hover:border-[#8B5CF6]/60`}
                >
                  <Download size={13} /> MP3
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ===== OLED NIGHT / MINIMALIST SLEEP MODE ===== */}
      {oledSleepMode && (
        <div className="fixed inset-0 z-50 bg-black text-neutral-300 flex flex-col justify-between p-5 sm:p-8 select-none">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <Timer size={14} />
              <select
                value={sleepTimer}
                onChange={(e) => setSleep(e.target.value as SleepTimerOption)}
                className="bg-neutral-950 border border-neutral-800 text-neutral-300 rounded-lg px-2 py-1 text-xs focus:outline-none"
              >
                <option value="none">Hẹn giờ: Tắt</option>
                <option value="15">Hẹn giờ: 15p</option>
                <option value="30">Hẹn giờ: 30p</option>
                <option value="60">Hẹn giờ: 60p</option>
                <option value="chapter">Hết chương</option>
              </select>
            </div>
            <button
              onClick={() => setOledSleepMode(false)}
              className="px-3 py-1.5 rounded-full border border-neutral-800 text-xs text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors"
            >
              Thoát chế độ ngủ
            </button>
          </div>

          <div className="max-w-xl mx-auto w-full text-center space-y-5 my-auto px-2">
            {title && (
              <div className="text-xs uppercase tracking-wider text-neutral-500 truncate">
                {title.normalize('NFC')}
              </div>
            )}
            <p className="text-base sm:text-xl leading-relaxed text-neutral-200 font-serif">
              {(chunks[currentChunk] || '').normalize('NFC')}
            </p>
            {chunks[currentChunk + 1] && (
              <p className="text-xs sm:text-sm leading-relaxed text-neutral-600 font-serif line-clamp-3">
                {chunks[currentChunk + 1].normalize('NFC')}
              </p>
            )}
            <div className="text-xs text-neutral-500 tabular-nums">
              Đoạn {currentChunk + 1} / {Math.max(1, chunks.length)} · ~{estLeft}p còn lại
            </div>
          </div>

          <div className="flex items-center justify-center gap-5 pb-[env(safe-area-inset-bottom)]">
            <button
              onClick={() => seekToChunk(currentChunkRef.current - 3)}
              className="w-14 h-14 rounded-full border border-neutral-800 text-neutral-300 hover:border-neutral-600 text-sm font-semibold flex items-center justify-center"
              aria-label="Lùi 3 đoạn"
            >
              −3
            </button>
            <button
              onClick={togglePlayPause}
              className="w-20 h-20 rounded-full bg-indigo-950/80 border border-indigo-700/60 text-indigo-200 hover:bg-indigo-900/80 flex items-center justify-center shadow-lg"
              aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}
            >
              {isPlaying ? <Pause size={32} /> : <Play size={32} />}
            </button>
            <button
              onClick={() => seekToChunk(currentChunkRef.current + 3)}
              className="w-14 h-14 rounded-full border border-neutral-800 text-neutral-300 hover:border-neutral-600 text-sm font-semibold flex items-center justify-center"
              aria-label="Tiến 3 đoạn"
            >
              +3
            </button>
          </div>
        </div>
      )}

      {/* ===== PRONUNCIATION DICTIONARY MODAL ===== */}
      <PronunciationModal
        isOpen={showPronunciation}
        onClose={() => setShowPronunciation(false)}
        rules={pronunciationRules}
        onSaveRules={handleSavePronunciationRules}
        theme={theme}
      />

      {/* ===== BOOKSHELF MODAL ===== */}
      <BookshelfModal
        isOpen={showBookshelf}
        onClose={() => setShowBookshelf(false)}
        items={bookshelfItems}
        onResumeEntry={handleResumeBookshelf}
        onDeleteEntry={handleDeleteBookshelf}
        isLoggedIn={Boolean(user)}
        userLabel={user?.displayName || user?.email || ''}
        onOpenAuth={() => setShowAuthModal(true)}
        onSignOut={() => {
          signOutUser();
          setShowBookshelf(false);
        }}
        theme={theme}
      />

      {/* ===== AUTH MODAL ===== */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        theme={theme}
      />

      {/* ===== BOOKMARKLET MODAL ===== */}
      <BookmarkletModal
        isOpen={showBookmarklet}
        onClose={() => setShowBookmarklet(false)}
        theme={theme}
      />
    </div>
  );
}
