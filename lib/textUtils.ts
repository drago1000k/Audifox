// lib/textUtils.ts – Vietnamese text processing utilities

// Sanitize novel text: strip watermarks, URLs, dividers, and normalize Vietnamese NFC
export function sanitizeNovelText(text: string, blacklist: string[] = []): string {
  let t = text
    // Strip zero-width & directional control chars without inserting spaces
    .replace(/[\u200b-\u200f\u202a-\u202e\u00ad\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')
    // Re-attach any combining diacritics separated by stray spaces
    .replace(/\s+([\u0300-\u036f])/g, '$1')
    .normalize('NFC');

  // Remove URLs
  t = t.replace(/https?:\/\/[^\s]+/gi, '');

  // Remove common Vietnamese novel site watermarks
  const defaultWatermarks = [
    /truyenfull\.vn/gi,
    /truyen\.tv/gi,
    /wattpad\.com/gi,
    /tangthuvien\.vn/gi,
    /metruyen\.com/gi,
    /novelfull\.(com|net)/gi,
    /metruyencv\.com/gi,
    /doctruyen\d*\.com/gi,
    /truyenchu\.(vn|com)/gi,
    /sangtacviet\.vn/gi,
    /truyensex\d*\.com/gi,
  ];
  for (const r of defaultWatermarks) {
    t = t.replace(r, '');
  }

  // Apply user blacklist (plain strings or regex patterns)
  for (const word of blacklist) {
    if (!word.trim()) continue;
    try {
      const r = new RegExp(word, 'gi');
      t = t.replace(r, '');
    } catch {
      // plain string fallback
      t = t.split(word).join('');
    }
  }

  // Remove dividers
  t = t.replace(/^[*=─—_~\-]{3,}$/gm, '');

  // Clean up whitespace while preserving paragraph breaks (\n\n)
  t = t
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .normalize('NFC');

  return t.trim();
}

// Split cleaned novel text into distinct display paragraphs
export function splitIntoParagraphs(text: string): string[] {
  return text
    .normalize('NFC')
    .split(/\n{2,}|\r?\n/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim().normalize('NFC'))
    .filter(Boolean);
}

export interface ParagraphChunkMap {
  chunks: string[];
  paragraphToChunkStart: number[];
  chunkToParagraph: number[];
  hasTitleChunk: boolean;
}

// Build TTS chunks (<= maxLen) with exact bidirectional mapping to paragraphs
export function buildParagraphChunks(
  paragraphs: string[],
  maxLen = 450,
  chapterTitle = ''
): ParagraphChunkMap {
  const chunks: string[] = [];
  const paragraphToChunkStart: number[] = [];
  const chunkToParagraph: number[] = [];

  const cleanTitle = chapterTitle.trim();
  const hasTitleChunk = cleanTitle.length > 0 && cleanTitle.length <= 500;
  if (hasTitleChunk) {
    chunks.push(cleanTitle);
    chunkToParagraph.push(-1);
  }

  paragraphs.forEach((para, pIdx) => {
    paragraphToChunkStart.push(chunks.length);
    const subChunks = splitIntoChunks(para, maxLen);
    if (subChunks.length === 0) {
      chunks.push(para);
      chunkToParagraph.push(pIdx);
    } else {
      for (const sc of subChunks) {
        chunks.push(sc);
        chunkToParagraph.push(pIdx);
      }
    }
  });

  return { chunks, paragraphToChunkStart, chunkToParagraph, hasTitleChunk };
}

// Split text into TTS-friendly chunks (350–500 chars, break at sentence boundaries)
export function splitIntoChunks(text: string, maxLen = 450): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?。！？\n])\s+|(?<=\n)/);

  let current = '';
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;

    if (current.length + s.length + 1 <= maxLen) {
      current += (current ? ' ' : '') + s;
    } else {
      if (current) chunks.push(current);

      // If single sentence is too long, force-split at word boundaries
      if (s.length > maxLen) {
        const words = s.split(' ');
        let part = '';
        for (const w of words) {
          if (part.length + w.length + 1 <= maxLen) {
            part += (part ? ' ' : '') + w;
          } else {
            if (part) chunks.push(part);
            part = w;
          }
        }
        if (part) current = part;
        else current = '';
      } else {
        current = s;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks.filter((c) => c.trim().length > 0);
}

// Split into display sentences (for karaoke highlighting)
export function splitIntoSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?。！？\n])\s+|\n/);
  return raw.map((s) => s.trim()).filter(Boolean);
}

// Speed value to TTS rate string (+0%, +25%, -25%, etc.)
export function speedToRate(speed: number): string {
  const pct = Math.round((speed - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

// Pitch slider (-5 to +5) to TTS pitch string
export function pitchToHz(pitch: number): string {
  const hz = Math.round(pitch * 10);
  return hz >= 0 ? `+${hz}Hz` : `${hz}Hz`;
}

// Format seconds as mm:ss
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Estimate reading time (avg ~300 chars/min for TTS)
export function estimateMinutes(charCount: number, speed = 1): number {
  return Math.ceil(charCount / (300 * speed));
}
