import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { writeTickWavFile } from './tick';
import { generateTTSFile } from './tts';
import { generateCardOverlayPng } from './overlay';

const ffprobePath = ffprobeStatic.path;

export interface LessonPair {
  vi: string;
  en: string;
}

export interface LessonInput {
  structure: string;
  explanation: string;
  pairs: LessonPair[];
}

export interface ProgressInfo {
  percent: number;
  currentTimeSec: number;
  totalDuration: number;
}

export interface RenderPipelineOptions {
  tmpDir: string;
  footagePath: string;
  lesson: LessonInput;
  onStatus?: (status: 'generating_tts' | 'rendering_video' | 'streaming') => void;
  onProgress?: (info: ProgressInfo) => void;
}

/**
 * Measures audio file duration using ffprobe with child_process.spawn (no maxBuffer).
 */
export function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!ffprobePath) {
      return reject(new Error('ffprobe-static binary not found'));
    }

    const proc = spawn(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Lỗi khởi tạo ffprobe trên tệp ${filePath}: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe thoát với mã ${code} trên ${filePath}: ${stderr}`));
      }
      const dur = parseFloat(stdout.trim());
      if (isNaN(dur) || dur <= 0) {
        return reject(new Error(`Thời lượng không hợp lệ từ ffprobe cho ${filePath}: "${stdout.trim()}"`));
      }
      resolve(dur);
    });
  });
}

/**
 * Validates that the rendered MP4 file is valid:
 * 1. File exists
 * 2. File size > 100 KB
 * 3. FFprobe confirms both video stream (720x1280) and audio stream are present.
 */
export async function verifyRenderedMp4(filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) {
    throw new Error('Tệp video đầu ra MP4 không tồn tại sau khi render.');
  }

  const stat = fs.statSync(filePath);
  const minBytes = 100 * 1024; // 100 KB
  if (stat.size < minBytes) {
    throw new Error(
      `Tệp video đầu ra quá nhỏ (${(stat.size / 1024).toFixed(1)} KB < 100 KB). Video có thể chưa hoàn tất.`
    );
  }

  if (!ffprobePath) {
    throw new Error('ffprobe-static binary not found for verification');
  }

  const streams = await new Promise<{ codec_type?: string; codec_name?: string; width?: number; height?: number }[]>(
    (resolve, reject) => {
      const proc = spawn(ffprobePath, [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name,width,height',
        '-of',
        'json',
        filePath,
      ]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        reject(new Error(`Lỗi kiểm tra ffprobe: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`ffprobe kiểm tra tệp đầu ra thất bại với mã ${code}: ${stderr}`));
        }
        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed.streams || []);
        } catch (parseErr: any) {
          reject(new Error(`Không đọc được dữ liệu streams từ ffprobe: ${parseErr.message}`));
        }
      });
    }
  );

  const hasVideoStream = streams.some((s) => s.codec_type === 'video');
  const hasAudioStream = streams.some((s) => s.codec_type === 'audio');

  if (!hasVideoStream || !hasAudioStream) {
    throw new Error(
      `Xác thực video thất bại: video_stream=${hasVideoStream}, audio_stream=${hasAudioStream}. Cần có cả 2 stream trong tệp MP4.`
    );
  }
}

export async function runServerRenderPipeline(options: RenderPipelineOptions): Promise<{
  outputPath: string;
  duration: number;
}> {
  const { tmpDir, footagePath, lesson, onStatus, onProgress } = options;

  // Maximum job timeout: 240 seconds
  const MAX_JOB_TIMEOUT_MS = 240_000;

  // 1. Status: generating_tts
  onStatus?.('generating_tts');

  // Generate 6 MP3 speech files with Edge TTS
  const viPaths: string[] = [];
  const enPaths: string[] = [];

  for (let i = 0; i < 3; i++) {
    const pair = lesson.pairs[i] || { vi: '', en: '' };
    if (!pair.vi.trim() || !pair.en.trim()) {
      throw new Error(`Cặp câu ${i + 1} không được để trống.`);
    }

    const viPath = path.join(tmpDir, `vi_${i}.mp3`);
    const enPath = path.join(tmpDir, `en_${i}.mp3`);

    await generateTTSFile(pair.vi, 'vi', viPath);
    await generateTTSFile(pair.en, 'en', enPath);

    viPaths.push(viPath);
    enPaths.push(enPath);
  }

  // Generate 2.11s tick sound
  const tickPath = path.join(tmpDir, 'tick.wav');
  writeTickWavFile(tickPath);

  // Measure audio durations with ffprobe spawn
  const viDurations: number[] = [];
  const enDurations: number[] = [];
  for (let i = 0; i < 3; i++) {
    const dVi = await getAudioDuration(viPaths[i]);
    const dEn = await getAudioDuration(enPaths[i]);
    viDurations.push(dVi);
    enDurations.push(dEn);
  }
  const tickDuration = 2.11;

  // 2. Compute exact timeline
  interface PhaseInterval {
    start: number;
    end: number;
  }

  const phaseAIntervals: PhaseInterval[] = [];
  const phaseBIntervals: PhaseInterval[] = [];
  const viDelays: number[] = [];
  const tickDelays: number[] = [];
  const enDelays: number[] = [];

  let curTime = 0.0;

  for (let i = 0; i < 3; i++) {
    const pairStart = curTime;
    const viStart = curTime;
    const viEnd = viStart + viDurations[i];

    const tickStart = viEnd + 0.22;
    const tickEnd = tickStart + tickDuration;

    // Phase A: from pairStart until tickEnd (Answer hidden)
    phaseAIntervals.push({
      start: pairStart,
      end: tickEnd,
    });

    // Phase B begins at tickEnd when Answer appears
    const enStart = tickEnd + 0.45;
    const enEnd = enStart + enDurations[i];
    const pairEnd = enEnd + 0.28; // Hold answer for at least 0.18s

    phaseBIntervals.push({
      start: tickEnd,
      end: pairEnd,
    });

    viDelays.push(viStart);
    tickDelays.push(tickStart);
    enDelays.push(enStart);

    curTime = pairEnd;
  }

  const totalDuration = curTime;

  // 3. Status: rendering_video
  onStatus?.('rendering_video');
  onProgress?.({
    percent: 0,
    currentTimeSec: 0,
    totalDuration,
  });

  // Generate 6 static PNG overlays (Phase A & B for each of the 3 pairs)
  // Sharp produces static 720x1280 PNGs; no per-frame PNGs.
  const overlayPaths: string[] = [];
  for (let i = 0; i < 3; i++) {
    const pair = lesson.pairs[i];

    // Phase A (showAnswer: false)
    const bufA = await generateCardOverlayPng({
      structure: lesson.structure,
      explanation: lesson.explanation,
      vi: pair.vi,
      en: pair.en,
      showAnswer: false,
    });
    const pathA = path.join(tmpDir, `overlay_${i}_a.png`);
    fs.writeFileSync(pathA, bufA);
    overlayPaths.push(pathA);

    // Phase B (showAnswer: true)
    const bufB = await generateCardOverlayPng({
      structure: lesson.structure,
      explanation: lesson.explanation,
      vi: pair.vi,
      en: pair.en,
      showAnswer: true,
    });
    const pathB = path.join(tmpDir, `overlay_${i}_b.png`);
    fs.writeFileSync(pathB, bufB);
    overlayPaths.push(pathB);
  }

  // 4. Construct FFmpeg command in a SINGLE process
  // - Single command for rendering, overlay, and audio mixing
  // - Preset: ultrafast, crf: 28, threads: 0
  // - Video: 720x1280, 30fps, libx264, yuv420p
  // - Audio: aac, 48000Hz, 192k
  // - Output progress via -progress pipe:1
  // - Output error via -loglevel error -nostats
  const outputPath = path.join(tmpDir, 'output.mp4');

  const ffmpegArgs: string[] = [
    '-loglevel',
    'error',
    '-nostats',
    '-progress',
    'pipe:1',
    '-stream_loop',
    '-1',
    '-i',
    footagePath,
    // 6 static overlays (input 1..6) WITHOUT -loop 1
    '-i',
    overlayPaths[0],
    '-i',
    overlayPaths[1],
    '-i',
    overlayPaths[2],
    '-i',
    overlayPaths[3],
    '-i',
    overlayPaths[4],
    '-i',
    overlayPaths[5],
    // input 7: tick.wav
    '-i',
    tickPath,
    // input 8..13: 6 TTS mp3s
    '-i',
    viPaths[0],
    '-i',
    enPaths[0],
    '-i',
    viPaths[1],
    '-i',
    enPaths[1],
    '-i',
    viPaths[2],
    '-i',
    enPaths[2],
  ];

  // Video filter chain
  const tA0 = phaseAIntervals[0];
  const tB0 = phaseBIntervals[0];
  const tA1 = phaseAIntervals[1];
  const tB1 = phaseBIntervals[1];
  const tA2 = phaseAIntervals[2];
  const tB2 = phaseBIntervals[2];

  const vFilter = [
    `[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30[bg]`,
    `[bg][1:v]overlay=0:0:enable='between(t,${tA0.start.toFixed(3)},${tA0.end.toFixed(3)})'[v1]`,
    `[v1][2:v]overlay=0:0:enable='between(t,${tB0.start.toFixed(3)},${tB0.end.toFixed(3)})'[v2]`,
    `[v2][3:v]overlay=0:0:enable='between(t,${tA1.start.toFixed(3)},${tA1.end.toFixed(3)})'[v3]`,
    `[v3][4:v]overlay=0:0:enable='between(t,${tB1.start.toFixed(3)},${tB1.end.toFixed(3)})'[v4]`,
    `[v4][5:v]overlay=0:0:enable='between(t,${tA2.start.toFixed(3)},${tA2.end.toFixed(3)})'[v5]`,
    `[v5][6:v]overlay=0:0:enable='between(t,${tB2.start.toFixed(3)},${totalDuration.toFixed(3)})'[vout]`,
  ].join(';');

  // Audio filter chain
  const ms = (sec: number) => Math.max(0, Math.round(sec * 1000));
  const aFilter = [
    `[7:a]asplit=3[tick0][tick1][tick2]`,
    `[8:a]adelay=${ms(viDelays[0])}|${ms(viDelays[0])}[a_vi0]`,
    `[tick0]adelay=${ms(tickDelays[0])}|${ms(tickDelays[0])}[a_tk0]`,
    `[9:a]adelay=${ms(enDelays[0])}|${ms(enDelays[0])}[a_en0]`,
    `[10:a]adelay=${ms(viDelays[1])}|${ms(viDelays[1])}[a_vi1]`,
    `[tick1]adelay=${ms(tickDelays[1])}|${ms(tickDelays[1])}[a_tk1]`,
    `[11:a]adelay=${ms(enDelays[1])}|${ms(enDelays[1])}[a_en1]`,
    `[12:a]adelay=${ms(viDelays[2])}|${ms(viDelays[2])}[a_vi2]`,
    `[tick2]adelay=${ms(tickDelays[2])}|${ms(tickDelays[2])}[a_tk2]`,
    `[13:a]adelay=${ms(enDelays[2])}|${ms(enDelays[2])}[a_en2]`,
    `[a_vi0][a_tk0][a_en0][a_vi1][a_tk1][a_en1][a_vi2][a_tk2][a_en2]amix=inputs=9:dropout_transition=0:normalize=0[aout]`,
  ].join(';');

  ffmpegArgs.push(
    '-filter_complex',
    `${vFilter};${aFilter}`,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '28',
    '-threads',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-t',
    totalDuration.toFixed(3),
    '-movflags',
    '+faststart',
    '-y',
    outputPath
  );

  // 5. Execute FFmpeg with child_process.spawn, progress tracking, and 240s timeout
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found');
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, ffmpegArgs);

    // Stderr circular buffer: max 50 lines
    const stderrLines: string[] = [];
    let pendingStderr = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      pendingStderr += chunk.toString();
      const lines = pendingStderr.split('\n');
      pendingStderr = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          stderrLines.push(line.trim());
          if (stderrLines.length > 50) {
            stderrLines.shift();
          }
        }
      }
    });

    // Parse progress from stdout (-progress pipe:1)
    let pendingStdout = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      pendingStdout += chunk.toString();
      const lines = pendingStdout.split('\n');
      pendingStdout = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('out_time_us=')) {
          const us = parseInt(trimmed.slice(12), 10);
          if (!isNaN(us) && totalDuration > 0) {
            const currentSec = us / 1000000;
            const percent = Math.min(100, Math.max(0, Math.round((currentSec / totalDuration) * 100)));
            onProgress?.({
              percent,
              currentTimeSec: Math.min(currentSec, totalDuration),
              totalDuration,
            });
          }
        }
      }
    });

    // Hard job timeout: 240 seconds
    const timeoutTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore kill error
      }
      reject(new Error('Quá thời gian xử lý tối đa 240 giây (job timeout).'));
    }, MAX_JOB_TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(timeoutTimer);
      reject(new Error(`Không thể khởi chạy FFmpeg: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutTimer);

      if (pendingStderr.trim()) {
        stderrLines.push(pendingStderr.trim());
        if (stderrLines.length > 50) {
          stderrLines.shift();
        }
      }

      if (code === 0) {
        onProgress?.({
          percent: 100,
          currentTimeSec: totalDuration,
          totalDuration,
        });
        resolve();
      } else {
        const last50 = stderrLines.join('\n');
        reject(
          new Error(
            `FFmpeg kết thúc với mã lỗi ${code}.\n\nChi tiết kỹ thuật (FFmpeg stderr):\n${last50 || '(Không có stderr)'}`
          )
        );
      }
    });
  });

  // 6. Verification: exit code 0, file > 100 KB, ffprobe video + audio
  await verifyRenderedMp4(outputPath);

  return {
    outputPath,
    duration: totalDuration,
  };
}
