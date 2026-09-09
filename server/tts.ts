import fs from 'fs';
import path from 'path';
import { EdgeTTS } from 'node-edge-tts';

export async function generateTTSFile(
  text: string,
  language: 'vi' | 'en',
  destinationPath: string
): Promise<void> {
  const config =
    language === 'vi'
      ? {
          voice: 'vi-VN-HoaiMyNeural',
          lang: 'vi-VN',
          rate: '+0%',
          pitch: '+0Hz',
          volume: '+0%',
        }
      : {
          voice: 'en-US-JennyNeural',
          lang: 'en-US',
          rate: '-20%',
          pitch: '+0Hz',
          volume: '+0%',
        };

  const tts = new EdgeTTS(config);
  let lastError: any = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await tts.ttsPromise(text.trim(), destinationPath);

      if (fs.existsSync(destinationPath)) {
        const stat = fs.statSync(destinationPath);
        if (stat.size > 0) {
          return;
        }
      }
      throw new Error(`TTS file ${destinationPath} was created empty`);
    } catch (err: any) {
      lastError = err;
      if (attempt < 2) {
        await new Promise((res) => setTimeout(res, 600));
      }
    }
  }

  throw lastError || new Error(`Failed to generate TTS for "${text}"`);
}
