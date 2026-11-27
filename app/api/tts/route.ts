import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 25;

const VOICES = [
  'vi-VN-HoaiMyNeural',
  'vi-VN-NamMinhNeural',
];

function escapeSSML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Use msedge-tts via WebSocket to get audio stream
async function synthesize(
  text: string,
  voice: string,
  rate: string,
  pitch: string
): Promise<Buffer> {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
  const tts = new MsEdgeTTS();

  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeSSML(text), { rate, pitch });

    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const timeout = setTimeout(() => {
        reject(new Error('TTS timeout after 20s'));
      }, 20000);

      audioStream.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      audioStream.on('end', () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks));
      });

      audioStream.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  } finally {
    try {
      tts.close();
    } catch {
      // ignore close errors
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      text = '',
      voice = 'vi-VN-HoaiMyNeural',
      rate = '+0%',
      pitch = '+0Hz',
    } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    if (text.length > 600) {
      return NextResponse.json({ error: 'Text too long; keep under 600 chars per chunk' }, { status: 400 });
    }

    const validVoice = VOICES.includes(voice) ? voice : VOICES[0];
    const audioBuffer = await synthesize(text, validVoice, rate, pitch);

    return new NextResponse(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
        'Content-Length': audioBuffer.length.toString(),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'TTS synthesis failed';
    console.error('[TTS Error]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Quick test endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    voices: VOICES,
    message: 'POST { text, voice, rate, pitch } to get audio/mpeg',
  });
}
