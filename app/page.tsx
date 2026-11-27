'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Moon, Sun, BookOpen, Upload, Link2, RotateCcw,
  Timer, Music2, Download, Settings2, X, Check, AlertCircle, Loader2,
  List
} from 'lucide-react';
import {
  splitIntoParagraphs,
  buildParagraphChunks,
  sanitizeNovelText,
  speedToRate,
  pitchToHz,
  estimateMinutes,
} from '@/lib/textUtils';
import { saveSession, loadSession, clearSession, SessionData } from '@/lib/db';
import { startAmbient, AmbientType, AmbientController } from '@/lib/ambientAudio';

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
  const [sourceDomain, setSourceDomain] = useState('');
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [chunks, setChunks] = useState<string[]>([]);
  const [paragraphToChunkStart, setParagraphToChunkStart] = useState<number[]>([]);
  const [chunkToParagraph, setChunkToParagraph] = useState<number[]>([]);

  // Pre-fetched next chapter
  const nextChapterRef = useRef<{ title: string; content: string; nextUrl: string | null } | null>(null);
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
  const playChunkRef = useRef<(index: number) => void>(() => {});
  const persistNowRef = useRef<(overrideChunk?: number) => void>(() => {});

  // --- Ambient ---
  const [ambientType, setAmbientType] = useState<AmbientType>('none');
  const [ambientVolume, setAmbientVolume] = useState(0.15);
  const ambientController = useRef<AmbientController | null>(null);

  // --- Sleep Timer ---
  const [sleepTimer, setSleepTimer] = useState<SleepTimerOption>('none');
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Loading/Error State ---
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
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

    const clampedStart = Math.max(0, Math.min(startChunk, Math.max(0, newChunks.length - 1)));

    hasTitleChunkRef.current = hasTitleChunk;
    setParagraphs(newParagraphs);
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

  // ========== SCRAPE API ==========
  async function fetchChapter(url: string): Promise<{ title: string; content: string; nextUrl: string | null; sourceDomain: string }> {
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

  async function handleFetchAndPlay() {
    if (!urlInput.trim()) return;
    setIsFetching(true);
    setFetchError('');
    stopPlayback();

    try {
      const data = await fetchChapter(urlInput.trim());
      setTitle(data.title);
      setContent(data.content);
      setNextUrl(data.nextUrl);
      setSourceDomain(data.sourceDomain);
      processContent(data.content, 0, data.title);
      setPlaylist((prev) => [...prev, { title: data.title, url: urlInput.trim() }]);

      setTimeout(() => startPlayback(0), 100);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch chapter');
    } finally {
      setIsFetching(false);
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
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: chunkText,
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
      const data = await fetchChapter(nextUrl);
      nextChapterRef.current = data;
    } catch {}
  }

  async function playChunk(index: number) {
    if (!isPlayingRef.current) return;
    const c = chunksRef.current;
    if (index >= c.length) {
      // Chapter finished
      if (autoNext && nextChapterRef.current) {
        loadNextChapter();
      } else if (autoNext && nextUrl) {
        // Wasn't pre-fetched yet
        await prefetchNextChapter();
        if (nextChapterRef.current) loadNextChapter();
        else setIsPlaying(false);
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

    try {
      const blobUrl = await fetchAudioBlob(index, c[index]);
      prefetchChunks(index + 1);

      // 1.5s natural pause before reading the chapter title
      if (index === 0 && hasTitleChunkRef.current) {
        await new Promise<void>((resolve) => {
          pauseTimerRef.current = setTimeout(resolve, 1500);
        });
      }

      if (!isPlayingRef.current) return;

      const audio = audioRef.current;
      if (!audio) return;

      audio.src = blobUrl;
      audio.playbackRate = speed;
      audio.volume = volume;

      await audio.play();
    } catch {
      if (isPlayingRef.current) {
        // Skip broken chunk
        setTimeout(() => playChunkRef.current(index + 1), 200);
      }
    }
  }

  playChunkRef.current = playChunk;

  function loadNextChapter() {
    const next = nextChapterRef.current;
    if (!next) return;

    setTitle(next.title);
    setContent(next.content);
    setNextUrl(next.nextUrl);
    setPlaylist((prev) => [...prev, { title: next.title, url: nextUrl || '' }]);
    processContent(next.content, 0, next.title);

    // Start playing after state settles
    setTimeout(() => {
      if (isPlayingRef.current) playChunkRef.current(0);
    }, 200);
  }

  function startPlayback(fromChunk = currentChunkRef.current) {
    isPlayingRef.current = true;
    setIsPlaying(true);
    playChunk(fromChunk);
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
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    persistNowRef.current(currentChunkRef.current);
  }

  function togglePlayPause() {
    if (isPlayingRef.current) {
      stopPlayback();
    } else {
      setResumeBanner(null);
      startPlayback(currentChunkRef.current);
    }
  }

  function seekToChunk(targetChunk: number, autoPlay = isPlayingRef.current) {
    const clamped = Math.max(0, Math.min(targetChunk, Math.max(0, chunksRef.current.length - 1)));
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }

    setResumeBanner(null);
    setCurrentChunk(clamped);
    currentChunkRef.current = clamped;
    const pIdx = chunkToParagraphRef.current[clamped] ?? -1;
    setActiveParagraph(pIdx);
    persistNowRef.current(clamped);

    if (autoPlay) {
      isPlayingRef.current = true;
      setIsPlaying(true);
      playChunkRef.current(clamped);
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
        // 1.5s natural pause after reading the chapter title
        if (finishedIdx === 0 && hasTitleChunkRef.current) {
          pauseTimerRef.current = setTimeout(() => {
            if (isPlayingRef.current) playChunkRef.current(finishedIdx + 1);
          }, 1500);
        } else {
          playChunkRef.current(finishedIdx + 1);
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

  // ========== AUTO-SAVE SESSION (Immediate + beforeunload) ==========
  const persistSession = useCallback(
    (overrideChunk?: number) => {
      if (!content) return;
      saveSession({
        url: urlInput,
        title,
        content,
        nextUrl,
        sourceDomain,
        chunkIndex: overrideChunk ?? currentChunkRef.current,
        totalChunks: chunksRef.current.length,
        voice,
        rate: speed,
        pitch,
        theme,
        fontSize,
        fontFamily,
        autoNext,
        volume,
      }).catch(() => {});
    },
    [urlInput, title, content, nextUrl, sourceDomain, voice, speed, pitch, theme, fontSize, fontFamily, autoNext, volume]
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

  // ========== AMBIENT SOUND ==========
  useEffect(() => {
    ambientController.current?.stop();
    ambientController.current = null;
    if (ambientType !== 'none') {
      ambientController.current = startAmbient(ambientType, ambientVolume);
    }
    return () => { ambientController.current?.stop(); };
  }, [ambientType]);

  useEffect(() => {
    ambientController.current?.setVolume(ambientVolume);
  }, [ambientVolume]);

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
    dark: 'bg-gray-950 text-gray-100',
    sepia: 'bg-amber-50 text-amber-900',
    light: 'bg-white text-gray-900',
  };

  const panelClasses: Record<Theme, string> = {
    dark: 'bg-gray-900 border-gray-800',
    sepia: 'bg-amber-100 border-amber-300',
    light: 'bg-gray-50 border-gray-200',
  };

  const fontFamilyMap: Record<FontFamily, string> = {
    sans: 'font-sans',
    serif: 'font-serif',
    mono: 'font-mono',
  };

  return (
    <div className={`min-h-screen ${themeClasses[theme]} transition-colors duration-300`}>
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
        <div className="max-w-5xl mx-auto px-4 py-3">
          {/* Logo + Title row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="text-indigo-500" size={22} />
              <span className="font-bold text-lg tracking-tight">Audifox</span>
              {title && (
                <span className={`text-sm truncate max-w-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  — {title}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Theme toggle */}
              <button onClick={() => setTheme(t => t === 'dark' ? 'sepia' : t === 'sepia' ? 'light' : 'dark')}
                className={`p-2 rounded-lg ${panelClasses[theme]} border`} title="Đổi theme">
                {theme === 'dark' ? <Moon size={16} /> : theme === 'sepia' ? <BookOpen size={16} /> : <Sun size={16} />}
              </button>
              {/* Settings */}
              <button onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg ${panelClasses[theme]} border`} title="Cài đặt">
                <Settings2 size={16} />
              </button>
              {/* Playlist */}
              {playlist.length > 0 && (
                <button onClick={() => setShowPlaylist(!showPlaylist)}
                  className={`p-2 rounded-lg ${panelClasses[theme]} border`} title="Danh sách chương">
                  <List size={16} />
                </button>
              )}
            </div>
          </div>

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
            <div className="flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchAndPlay()}
                placeholder="Dán URL chương truyện... (vd: truyenfull.vn/truyen/chuong-1)"
                className={`flex-1 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500' : theme === 'sepia' ? 'bg-amber-50 border-amber-300 text-amber-900 placeholder-amber-400' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`}
              />
              <button
                onClick={handleFetchAndPlay}
                disabled={isFetching || !urlInput.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
                {isFetching ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {isFetching ? 'Đang tải...' : 'Phát'}
              </button>
              {nextUrl && (
                <button onClick={async () => {
                  setUrlInput(nextUrl);
                  setTimeout(() => handleFetchAndPlay(), 50);
                }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${panelClasses[theme]} flex items-center gap-1`}
                  title="Chương tiếp theo">
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
        </div>
      </header>

      {/* ===== SETTINGS PANEL ===== */}
      {showSettings && (
        <div className={`sticky top-[9rem] z-30 border-b ${panelClasses[theme]}`}>
          <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap gap-4 items-center">
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
          </div>
        </div>
      )}

      {/* ===== BLACKLIST MODAL ===== */}
      {showBlacklist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className={`w-full max-w-md rounded-xl p-6 shadow-2xl ${theme === 'dark' ? 'bg-gray-900 text-white' : theme === 'sepia' ? 'bg-amber-50 text-amber-900' : 'bg-white text-gray-900'}`}>
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
      <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-52 pt-8">
        {/* Playlist sidebar */}
        {showPlaylist && playlist.length > 0 && (
          <div className={`mb-6 p-4 rounded-xl border ${panelClasses[theme]}`}>
            <h3 className="font-semibold mb-2 text-sm">📋 Danh sách chương đã đọc</h3>
            <ul className="space-y-1">
              {playlist.map((item, idx) => (
                <li key={idx} className="text-sm flex items-center gap-2">
                  <span className="opacity-40">{idx + 1}.</span>
                  <button onClick={() => { setUrlInput(item.url); handleFetchAndPlay(); }}
                    className="hover:text-indigo-500 text-left truncate">{item.title || item.url}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Chapter title */}
        {title && (
          <div className="mb-8 pb-4 border-b border-current/10 flex items-start justify-between gap-4">
            <h1
              onClick={() => seekToChunk(0, true)}
              className={`font-bold leading-snug cursor-pointer rounded-lg transition-colors ${fontFamilyMap[fontFamily]} ${
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

        {/* Chapter text as clean, spaced paragraphs */}
        {paragraphs.length > 0 ? (
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
                  className={`group relative cursor-pointer rounded-lg px-3.5 py-2.5 border-l-2 transition-all duration-200 ${
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
        <div className={`fixed bottom-0 inset-x-0 z-40 border-t ${panelClasses[theme]} player-bar`}>
          {/* Interactive Seek / Scrubbing Bar */}
          <div className="max-w-5xl mx-auto px-4 pt-2.5">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium tabular-nums opacity-70 whitespace-nowrap">
                Đoạn {currentChunk + 1} / {chunks.length}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0, chunks.length - 1)}
                value={currentChunk}
                onChange={(e) => seekToChunk(parseInt(e.target.value, 10))}
                aria-label="Tua tiến độ đọc"
                className="w-full h-1.5 accent-indigo-500 cursor-pointer"
              />
              <span className="text-xs font-medium tabular-nums opacity-70 whitespace-nowrap">
                {Math.round(((currentChunk + 1) / chunks.length) * 100)}% · ~{estLeft}p
              </span>
            </div>
          </div>

          <div className="max-w-5xl mx-auto px-4 py-2.5">
            {/* Row 1: Main controls */}
            <div className="flex items-center gap-3 mb-2">
              <button onClick={skipBack} className="p-1.5 rounded-full hover:bg-white/10 transition-colors">
                <SkipBack size={20} />
              </button>
              <button
                onClick={togglePlayPause}
                className="p-3 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-lg">
                {isPlaying ? <Pause size={22} /> : <Play size={22} />}
              </button>
              <button onClick={skipNext} className="p-1.5 rounded-full hover:bg-white/10 transition-colors">
                <SkipForward size={20} />
              </button>

              {/* Voice selector */}
              <select
                value={voice}
                onChange={e => setVoice(e.target.value)}
                className={`text-sm rounded-lg border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : theme === 'sepia' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-gray-300 text-gray-900'}`}>
                {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>

              {/* Speed */}
              <select
                value={speed}
                onChange={e => setSpeed(parseFloat(e.target.value))}
                className={`text-sm rounded-lg border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : theme === 'sepia' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-gray-300 text-gray-900'}`}>
                {SPEED_OPTIONS.map(s => <option key={s} value={s}>{s}x</option>)}
              </select>

              {/* Chunk counter + ETA */}
              <span className="text-xs opacity-50 ml-auto hidden sm:block">
                {currentChunk + 1}/{chunks.length} · ~{estLeft}p còn lại
              </span>
            </div>

            {/* Row 2: Volume + Auto-next + Sleep timer + Ambient + Export */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Volume */}
              <div className="flex items-center gap-1.5">
                <button onClick={() => setVolume(v => v > 0 ? 0 : 0.9)}>
                  {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input type="range" min="0" max="1" step="0.05" value={volume}
                  onChange={e => setVolume(parseFloat(e.target.value))}
                  className="w-20 accent-indigo-500" />
              </div>

              {/* Auto-next toggle */}
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <div className={`w-9 h-5 rounded-full relative transition-colors ${autoNext ? 'bg-indigo-600' : 'bg-gray-600'}`}
                  onClick={() => setAutoNext(a => !a)}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoNext ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                Tự động chương tiếp
              </label>

              {/* Sleep timer */}
              <div className="flex items-center gap-1 text-xs">
                <Timer size={14} className="opacity-60" />
                <select value={sleepTimer} onChange={e => setSleep(e.target.value as SleepTimerOption)}
                  className={`text-xs rounded border px-1.5 py-0.5 focus:outline-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : theme === 'sepia' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-gray-300 text-gray-900'}`}>
                  <option value="none">Tắt hẹn giờ</option>
                  <option value="15">15 phút</option>
                  <option value="30">30 phút</option>
                  <option value="60">60 phút</option>
                  <option value="chapter">Hết chương</option>
                </select>
              </div>

              {/* Ambient sound */}
              <div className="flex items-center gap-1 text-xs">
                <Music2 size={14} className="opacity-60" />
                <select value={ambientType} onChange={e => setAmbientType(e.target.value as AmbientType)}
                  className={`text-xs rounded border px-1.5 py-0.5 focus:outline-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : theme === 'sepia' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-gray-300 text-gray-900'}`}>
                  <option value="none">Không có tiếng nền</option>
                  <option value="rain">🌧 Mưa nhẹ</option>
                  <option value="brown">🤎 Tiếng ồn nâu</option>
                  <option value="fire">🔥 Lửa crackling</option>
                </select>
                {ambientType !== 'none' && (
                  <input type="range" min="0" max="0.5" step="0.01" value={ambientVolume}
                    onChange={e => setAmbientVolume(parseFloat(e.target.value))}
                    className="w-16 accent-indigo-500" />
                )}
              </div>

              {/* Export MP3 */}
              <button onClick={exportMp3} title="Xuất MP3"
                className={`ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded border ${panelClasses[theme]}`}>
                <Download size={13} /> MP3
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
