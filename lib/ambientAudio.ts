// lib/ambientAudio.ts – Web Audio API ambient sound synthesis

export type AmbientType = 'none' | 'rain' | 'brown' | 'fire';

export interface AmbientController {
  setVolume(vol: number): void;
  stop(): void;
}

function createRainNode(ctx: AudioContext): AudioNode {
  // White noise filtered to sound like rain
  const bufferSize = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 1000;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 8000;

  source.connect(highpass);
  highpass.connect(lowpass);
  source.start();
  return lowpass;
}

function createBrownNoiseNode(ctx: AudioContext): AudioNode {
  const bufferSize = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    data[i] = (last + 0.02 * white) / 1.02;
    last = data[i];
    data[i] *= 3.5;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 400;

  source.connect(lowpass);
  source.start();
  return lowpass;
}

function createFireNode(ctx: AudioContext): AudioNode {
  // Crackling fire: brown noise + random pops
  const bufferSize = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    data[i] = (last + 0.015 * white) / 1.015;
    last = data[i];
    // Add random crackles
    if (Math.random() < 0.0005) data[i] += (Math.random() - 0.5) * 0.8;
    data[i] *= 4;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const eq = ctx.createBiquadFilter();
  eq.type = 'lowpass';
  eq.frequency.value = 600;

  source.connect(eq);
  source.start();
  return eq;
}

export function startAmbient(type: AmbientType, volume: number): AmbientController | null {
  if (type === 'none') return null;

  const ctx = new AudioContext();
  const gainNode = ctx.createGain();
  gainNode.gain.value = volume;
  gainNode.connect(ctx.destination);

  let sourceNode: AudioNode;
  if (type === 'rain') sourceNode = createRainNode(ctx);
  else if (type === 'brown') sourceNode = createBrownNoiseNode(ctx);
  else sourceNode = createFireNode(ctx);

  sourceNode.connect(gainNode);

  return {
    setVolume(vol: number) {
      gainNode.gain.setTargetAtTime(vol, ctx.currentTime, 0.1);
    },
    stop() {
      gainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => ctx.close(), 500);
    },
  };
}
