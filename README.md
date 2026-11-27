# Audifox

Audifox is a Vietnamese web-novel audio reader built with Next.js. Paste a chapter URL (or text) and Audifox cleans the content and reads it aloud with natural Microsoft Edge neural voices, highlighting the active paragraph as it goes.

## Features

- **Read aloud** with Vietnamese neural voices (`vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`), adjustable speed and pitch
- **Chapter fetching** from supported sources (`tieuthuyetmang.com`) with next/previous chapter navigation and auto-next
- **Paragraph highlighting** with smooth auto-scroll and click-to-read-from-here
- **Reader sidebar** with chapter / sub-chapter index, reading history, and bookshelf (`Tủ truyện`)
- **1-click bookmarklet** to send a logged-in chapter from the source site into Audifox (PC and mobile)
- **Pronunciation dictionary** to fix how specific words are spoken
- **Text cleanup**: watermark / URL / divider removal, Vietnamese diacritic normalization, custom blacklist
- **Sleep timer**, keyboard shortcuts (`Space`, `←`, `→`, `Shift + ←/→`), Media Session controls
- **MP3 export** of the current chapter
- **Themes**: dark, sepia, light; adjustable font and size
- **Sync**: Firebase Auth + Firestore bookshelf, with IndexedDB local cache

## Tech stack

- [Next.js](https://nextjs.org/) (App Router) + React + TypeScript
- Tailwind CSS v4
- [`msedge-tts`](https://www.npmjs.com/package/msedge-tts) for speech synthesis (`/api/tts`)
- [`cheerio`](https://cheerio.js.org/) for chapter scraping (`/api/scrape`)
- Firebase (Auth + Firestore), IndexedDB
- `jszip` for EPUB parsing, `lucide-react` icons

## Project structure

```
app/
  page.tsx            Main reader UI and playback logic
  layout.tsx          Root layout
  globals.css         Global styles
  api/tts/route.ts    POST text -> audio/mpeg (Edge TTS)
  api/scrape/route.ts POST url -> cleaned chapter content
components/           Modals (Auth, Bookmarklet, Bookshelf, Pronunciation) and ReaderSidebar
lib/
  textUtils.ts        Text sanitizing, paragraph/chunk splitting, TTS helpers
  db.ts               IndexedDB helpers
  firebase.ts         Firebase setup
public/logo.png       App logo
firestore.rules       Firestore security rules
vercel.json           Vercel function limits
```

## Getting started

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

### Build for production

```bash
npm run build
npm start
```

## API

### `POST /api/tts`

```json
{ "text": "Xin chào", "voice": "vi-VN-HoaiMyNeural", "rate": "+0%", "pitch": "+0Hz" }
```

Returns `audio/mpeg`. `GET /api/tts` returns a health check and the available voices.

### `POST /api/scrape`

```json
{ "url": "https://tieuthuyetmang.com/..." }
```

Returns `{ title, content, nextUrl, prevUrl, sourceDomain }`, or a locked flag when the chapter requires login.

## Deployment

The app is set up for [Vercel](https://vercel.com/). `vercel.json` raises the function duration for `/api/tts` (25s) and `/api/scrape` (30s). Deploy Firestore rules from `firestore.rules` to your Firebase project.

## Notes

- Edge TTS is an unofficial endpoint; availability and rate limits may vary.
- Only scrape content you are allowed to access.
