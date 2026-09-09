import fs from 'fs';

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Synthesizes a real 48kHz mono 16-bit WAV file of exactly 2.11 seconds.
 * Produces crisp, gentle metronome countdown tick pulses.
 */
export function generateTickWavBuffer(): Buffer {
  const sampleRate = 48000;
  const duration = 2.11;
  const numSamples = Math.round(sampleRate * duration); // 101,280 samples
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit PCM

  const buffer = Buffer.alloc(44 + numSamples * bytesPerSample);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples * bytesPerSample, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // ByteRate
  view.setUint16(32, numChannels * bytesPerSample, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, numSamples * bytesPerSample, true);

  // Pulse sounds at ~0.1s and ~1.1s
  const tickTimes = [0.1, 1.1];

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    for (const tickTime of tickTimes) {
      const dt = t - tickTime;
      if (dt >= 0 && dt < 0.08) {
        // 1200Hz pulse with exponential decay
        const freq = 1200;
        const decay = Math.exp(-dt * 55);
        const sine = Math.sin(2 * Math.PI * freq * dt);
        sample += sine * decay * 0.45;
      }
    }

    // Clamp to 16-bit range
    sample = Math.max(-1, Math.min(1, sample));
    const intSample = Math.round(sample * 32767);
    view.setInt16(44 + i * 2, intSample, true);
  }

  return buffer;
}

export function writeTickWavFile(filePath: string): void {
  const buf = generateTickWavBuffer();
  fs.writeFileSync(filePath, buf);
}
