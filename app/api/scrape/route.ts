import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Cache-Control': 'max-age=0',
};

// Vietnamese next-chapter patterns
const NEXT_CHAPTER_PATTERNS = [
  /chương\s+tiếp/i,
  /chương\s+sau/i,
  /tiếp\s+theo/i,
  /trang\s+sau/i,
  /next\s+chapter/i,
  /next/i,
  />>/,
];

const NEXT_CHAPTER_IDS = ['#next_chap', '#next-chap', '#nextchapter', '#next'];
const NEXT_CHAPTER_CLASSES = [
  '.next-chap',
  '.next_chap',
  '.nextchap',
  '.chapter-next',
  '.btn-next',
  '.next-chapter',
  '.chapter-nav-next',
  '[rel="next"]',
];

// Vietnamese previous-chapter patterns
const PREV_CHAPTER_PATTERNS = [
  /chương\s+trước/i,
  /chương\s+cũ/i,
  /trang\s+trước/i,
  /^trước$/i,
  /prev(ious)?(\s+chapter)?/i,
  /<</,
];

const PREV_CHAPTER_IDS = ['#prev_chap', '#prev-chap', '#prevchapter', '#prev'];
const PREV_CHAPTER_CLASSES = [
  '.prev-chap',
  '.prev_chap',
  '.prevchap',
  '.chapter-prev',
  '.btn-prev',
  '.prev-chapter',
  '.chapter-nav-prev',
  '[rel="prev"]',
];

// Vietnamese novel content selectors (priority order)
const CONTENT_SELECTORS = [
  '#chapter-c',
  '.chapter-c',
  '#content',
  '.reading-content',
  '#vung_doc',
  '.entry-content',
  '.chapter-content',
  '#chapter-content',
  '.text-content',
  '#box_doc',
  '.truyen-content',
  'article.content',
  '#story-content',
  '.story-content',
  '.chapter_content',
  '.prose .whitespace-pre-wrap',
  '.prose',
];

function normalizeVietnamese(text: string): string {
  return text
    // Strip zero-width & directional control chars without inserting spaces
    .replace(/[\u200b-\u200f\u202a-\u202e\u00ad\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')
    // Re-attach any combining diacritics separated by stray spaces
    .replace(/\s+([\u0300-\u036f])/g, '$1')
    .normalize('NFC');
}

function cleanText(text: string, chapterTitle = ''): string {
  let cleaned = normalizeVietnamese(text)
    // Remove URLs
    .replace(/https?:\/\/[^\s]+/gi, '')
    // Remove common watermarks
    .replace(/\b(truyenfull|wattpad|tangthuvien|metruyen|truyen\.tv|novelfull|novelonlinefull|mê\s*truyện|truyện\s*full)\b/gi, '')
    // Remove dividers
    .replace(/[*=─—]{3,}/g, '')
    // Normalize spaces/tabs on each line while preserving newlines
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

  // Deduplicate leading chapter title or glued prefix (e.g. "...AaChương 1: ...Chương 1")
  if (chapterTitle) {
    const normTitle = normalizeVietnamese(chapterTitle).trim();
    const lowerTitle = normTitle.toLowerCase();
    const paragraphs = cleaned.split('\n\n');

    if (paragraphs.length > 0) {
      // Strip glued prefix like "...AaChương 1: ..." at the start of paragraph 0
      const first = paragraphs[0];
      const titleIdx = first.toLowerCase().indexOf(lowerTitle);
      if (titleIdx >= 0 && titleIdx < 120) {
        const afterTitle = first
          .slice(titleIdx + normTitle.length)
          .replace(/^[\s:.\-–—]*(chương\s+\d+\s*[:.\-–—]*)?/i, '')
          .trim();
        if (afterTitle) {
          paragraphs[0] = afterTitle;
        } else {
          paragraphs.shift();
        }
      }
    }

    while (paragraphs.length > 1) {
      const first = paragraphs[0].trim().toLowerCase();
      if (
        first === lowerTitle ||
        lowerTitle.includes(first) ||
        first.startsWith(lowerTitle)
      ) {
        paragraphs.shift();
      } else {
        break;
      }
    }
    cleaned = paragraphs.join('\n\n');
  }

  return cleaned.normalize('NFC');
}

type CheerioSelection = ReturnType<cheerio.CheerioAPI>;
type CheerioEl = CheerioSelection[number];

function extractTextDensity($: cheerio.CheerioAPI, el: CheerioEl): number {
  const text = $(el).text();
  const html = $(el).html() || '';
  // Count Vietnamese characters + paragraph/br tags
  const viChars = (text.match(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi) || []).length;
  const pCount = (html.match(/<p|<br/gi) || []).length;
  return viChars + pCount * 10;
}

function findBestContentElement($: cheerio.CheerioAPI, baseUrl: string): string {
  // Try known selectors first
  for (const sel of CONTENT_SELECTORS) {
    const el = $(sel);
    if (el.length && el.text().trim().length > 200) {
      return extractContent($, el.first());
    }
  }

  // Fallback: find innermost div/article/section with highest Vietnamese text density
  let bestEl: CheerioEl | null = null;
  let bestScore = 0;

  $('div, article, section').each((_, el) => {
    // Skip navigation/ads containers
    const cls = ($(el).attr('class') || '') + ($(el).attr('id') || '');
    if (/nav|header|footer|sidebar|ads|ad-|comment|related|menu|widget/i.test(cls)) return;

    const totalLen = $(el).text().trim().length;
    if (totalLen < 200) return;

    // Skip outer layout wrappers if a direct/nested child already holds >= 85% of the text
    const hasInnerContentChild = $(el)
      .children('div, article, section')
      .toArray()
      .some((child) => $(child).text().trim().length >= totalLen * 0.85);
    if (hasInnerContentChild) return;

    const score = extractTextDensity($, el);
    if (score > bestScore) {
      bestScore = score;
      bestEl = el;
    }
  });

  if (bestEl && bestScore > 100) {
    return extractContent($, $(bestEl));
  }

  // Last resort: body text
  return $('body').text().slice(0, 5000);
}

function extractContent($: cheerio.CheerioAPI, el: CheerioSelection): string {
  // Replace <br> with newlines before extracting text
  el.find('br').replaceWith('\n');

  const paragraphs: string[] = [];
  const pTags = el.find('p');

  if (pTags.length > 3) {
    pTags.each((_, node) => {
      const text = $(node).text().replace(/[ \t]+/g, ' ').trim();
      if (text) paragraphs.push(text);
    });
    if (paragraphs.length > 3) return paragraphs.join('\n\n');
  }

  // For pre-wrap or line-broken content, preserve every line break as a paragraph
  return el
    .text()
    .split(/\r?\n+/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

function findTitle($: cheerio.CheerioAPI): string {
  const selectors = [
    'h1.chapter-title',
    'h2.chapter-title',
    '.truyen-title',
    '.chapter-title',
    'h1',
    'h2',
    'title',
  ];

  for (const sel of selectors) {
    const text = normalizeVietnamese($(sel).first().text().trim());
    if (text && text.length < 200) return text;
  }
  return '';
}

function findNavUrl(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  ids: string[],
  classes: string[],
  patterns: RegExp[]
): string | null {
  // Try ID/class selectors first
  for (const sel of [...ids, ...classes]) {
    const href = $(sel).attr('href');
    if (href && href !== '#' && !href.startsWith('javascript')) {
      try {
        const resolved = new URL(href, baseUrl).href;
        if (resolved !== baseUrl) return resolved;
      } catch {}
    }
  }

  // Scan all links for text patterns
  let found: string | null = null;
  $('a').each((_, el) => {
    if (found) return;
    const href = $(el).attr('href');
    if (!href || href === '#' || href.startsWith('javascript')) return;

    const text = $(el).text().trim();
    const title = $(el).attr('title') || '';
    const combined = `${text} ${title}`.trim();

    if (patterns.some((p) => p.test(combined))) {
      try {
        const resolved = new URL(href, baseUrl).href;
        if (resolved !== baseUrl) found = resolved;
      } catch {}
    }
  });

  return found;
}

function findNextUrl($: cheerio.CheerioAPI, baseUrl: string): string | null {
  return findNavUrl($, baseUrl, NEXT_CHAPTER_IDS, NEXT_CHAPTER_CLASSES, NEXT_CHAPTER_PATTERNS);
}

function findPrevUrl($: cheerio.CheerioAPI, baseUrl: string): string | null {
  return findNavUrl($, baseUrl, PREV_CHAPTER_IDS, PREV_CHAPTER_CLASSES, PREV_CHAPTER_PATTERNS);
}

// In-memory cookie jar keyed by hostname
const cookieJar = new Map<string, string>();

const LOCKED_PATTERNS = [
  /chương này đang bị khóa/i,
  /đăng nhập để đọc tiếp/i,
  /vui lòng đăng nhập để (đọc|xem)/i,
  /bạn cần đăng nhập/i,
];

function mergeCookies(...parts: (string | undefined)[]): string {
  const map = new Map<string, string>();
  for (const part of parts) {
    if (!part) continue;
    for (const pair of part.split(';')) {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (k) map.set(k, v);
      }
    }
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function isLockedChapter(rawBodyText: string, cleanedContent: string): boolean {
  if (LOCKED_PATTERNS.some((p) => p.test(cleanedContent))) return true;
  if (cleanedContent.length < 80 && LOCKED_PATTERNS.some((p) => p.test(rawBodyText))) return true;
  return cleanedContent.trim().length < 40;
}

function parseSetCookies(res: Response): string {
  const headersObj = res.headers as Headers & { getSetCookie?: () => string[] };
  const rawCookies =
    typeof headersObj.getSetCookie === 'function'
      ? headersObj.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie') as string]
        : [];

  return rawCookies
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

function isAccessGatePage(responseUrl: string, html: string): boolean {
  return (
    responseUrl.includes('khong-co-pass') ||
    html.includes("404. That's an error.") ||
    html.includes('/api/access-gate')
  );
}

async function unlockAccessGate(
  origin: string,
  hostname: string,
  nextPath: string,
  gateHtml: string
): Promise<string | null> {
  // Detect form action/field name from gate HTML if present, fallback to known defaults
  const $gate = cheerio.load(gateHtml);
  const form = $gate('form[action*="access-gate"]').first();
  const action = form.attr('action') || '/api/access-gate';
  const keyField =
    form.find('input[type="text"], input[type="password"]').first().attr('name') || 'key';

  const unlockUrl = new URL(action, origin).href;
  const body = new URLSearchParams({
    next: nextPath || '/',
    [keyField]: 'tieuthuyetmang',
  });

  const unlockRes = await fetch(unlockUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: origin,
      Referer: `${origin}/khong-co-pass?next=${encodeURIComponent(nextPath || '/')}`,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });

  const cookieHeader = parseSetCookies(unlockRes);
  if (!cookieHeader) return null;

  cookieJar.set(hostname, cookieHeader);
  return cookieHeader;
}

export async function POST(req: NextRequest) {
  try {
    const { url, cookie: userCookie } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const customCookie = typeof userCookie === 'string' ? userCookie.trim() : '';
    const targetUrl = new URL(url);
    const buildHeaders = (cookie?: string): Record<string, string> => {
      const merged = mergeCookies(cookie, customCookie);
      return {
        ...BROWSER_HEADERS,
        Referer: targetUrl.origin,
        ...(merged ? { Cookie: merged } : {}),
      };
    };

    const cachedCookie = cookieJar.get(targetUrl.hostname);
    let res = await fetch(url, {
      headers: buildHeaders(cachedCookie),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `HTTP ${res.status}: Could not fetch page` },
        { status: 502 }
      );
    }

    let html = await res.text();

    // Auto-unlock if redirected to /khong-co-pass or disguised 404 gate
    if (isAccessGatePage(res.url, html)) {
      const nextPath = `${targetUrl.pathname}${targetUrl.search}`;
      const newCookie = await unlockAccessGate(
        targetUrl.origin,
        targetUrl.hostname,
        nextPath,
        html
      );

      if (newCookie) {
        res = await fetch(url, {
          headers: buildHeaders(newCookie),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          return NextResponse.json(
            { error: `HTTP ${res.status}: Could not fetch page after unlock` },
            { status: 502 }
          );
        }
        html = await res.text();
      }
    }

    const $ = cheerio.load(html);

    // Remove noise
    $('script, style, iframe, ins, noscript').remove();
    $('.ads, .advertisement, .adsense, [class*="ads-"], [id*="ads-"]').remove();
    $('nav, footer, header, .nav, .footer, .header').remove();
    $('[class*="comment"], [id*="comment"]').remove();
    $('[class*="related"], [id*="related"]').remove();
    $('[class*="social"], [id*="social"]').remove();

    const title = findTitle($);
    const rawBodyText = $('body').text();
    const rawContent = findBestContentElement($, url);
    const content = cleanText(rawContent, title);
    const nextUrl = findNextUrl($, url);
    const prevUrl = findPrevUrl($, url);
    const sourceDomain = targetUrl.hostname;

    if (isLockedChapter(rawBodyText, content)) {
      return NextResponse.json({
        title,
        content: '',
        nextUrl,
        prevUrl,
        sourceDomain,
        locked: true,
        reason: 'LOGIN_REQUIRED',
      });
    }

    return NextResponse.json({
      title,
      content,
      nextUrl,
      prevUrl,
      sourceDomain,
      locked: false,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
