import { AudioItem } from '../types';

let audioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioCtxClass({ sampleRate: 48000 });
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Generates a real 48kHz mono 16-bit WAV file of exactly 2.11 seconds.
 * Synthesizes a realistic gentle clock tick sound (countdown metronome).
 */
export function generateTickAudioWav(): { blob: Blob; buffer: ArrayBuffer; duration: number } {
  const sampleRate = 48000;
  const duration = 2.11;
  const numSamples = Math.round(sampleRate * duration); // 101,280 samples
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit

  // RIFF header is 44 bytes
  const buffer = new ArrayBuffer(44 + numSamples * bytesPerSample);
  const view = new DataView(buffer);

  // Write RIFF identifier 'RIFF'
  writeString(view, 0, 'RIFF');
  // File length minus first 8 bytes
  view.setUint32(4, 36 + numSamples * bytesPerSample, true);
  // RIFF type 'WAVE'
  writeString(view, 8, 'WAVE');
  // Format chunk marker 'fmt '
  writeString(view, 12, 'fmt ');
  // Format chunk length: 16 for PCM
  view.setUint32(16, 16, true);
  // Sample format: 1 (PCM)
  view.setUint16(20, 1, true);
  // Channels: 1
  view.setUint16(22, numChannels, true);
  // Sample rate
  view.setUint32(24, sampleRate, true);
  // Byte rate: sampleRate * numChannels * bytesPerSample
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  // Block align: numChannels * bytesPerSample
  view.setUint16(32, numChannels * bytesPerSample, true);
  // Bits per sample: 16
  view.setUint16(34, 16, true);
  // Data chunk identifier 'data'
  writeString(view, 36, 'data');
  // Data chunk length
  view.setUint32(40, numSamples * bytesPerSample, true);

  // Synthesize tick pulse sound:
  // 2 ticks placed at ~0.1s and ~1.1s, each tick lasting ~0.08s with 1200Hz frequency decaying fast
  const tickTimes = [0.1, 1.1];
  let offset = 44;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sampleVal = 0;

    for (const tickTime of tickTimes) {
      if (t >= tickTime && t < tickTime + 0.12) {
        const dt = t - tickTime;
        // High frequency damped sine wave for a crisp wooden clock tick
        const decay = Math.exp(-dt * 65); // fast decay
        const wave = Math.sin(2 * Math.PI * 1400 * dt);
        // Volume is softer than speech (amplitude ~0.22)
        sampleVal += wave * decay * 0.22;
      }
    }

    // Clamp between -1 and 1
    const clamped = Math.max(-1, Math.min(1, sampleVal));
    // Convert to 16-bit integer
    const intVal = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, intVal, true);
    offset += 2;
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return { blob, buffer, duration };
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Fetches real TTS audio from the local Node server route POST /api/tts.
 * Returns the raw audio buffer, blob, and exact duration decoded with AudioContext.
 */
export async function fetchAudioTTS(text: string, language: 'vi' | 'en'): Promise<AudioItem> {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, language }),
  });

  if (!response.ok) {
    let errMsg = `TTS request failed with status ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error) errMsg = errJson.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('audio/mpeg') && !contentType.includes('audio/mp3')) {
    throw new Error(`Invalid TTS response content-type: ${contentType}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error('Received 0 bytes of audio from TTS');
  }

  // Exact duration measurement using AudioContext
  const ctx = getAudioContext();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const duration = audioBuffer.duration;

  const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });

  return {
    blob,
    buffer: arrayBuffer,
    duration,
  };
}

/**
 * Plays an ArrayBuffer or Blob audio using HTMLAudioElement or Web Audio API.
 */
export async function playAudioBuffer(buffer: ArrayBuffer): Promise<void> {
  const blob = new Blob([buffer], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  return new Promise((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    audio.play().catch(reject);
  });
}
