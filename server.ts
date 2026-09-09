import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import busboy from 'busboy';
import { createServer as createViteServer } from 'vite';
import { runServerRenderPipeline, LessonInput } from './server/renderPipeline';
import { generateTTSFile } from './server/tts';
import { registerBatchRoutes } from './server/batchQueue';

export interface ActiveJob {
  id: string;
  status: 'uploading' | 'generating_tts' | 'rendering_video' | 'streaming' | 'completed' | 'error';
  progress?: number;
  currentTimeSec?: number;
  totalDuration?: number;
  error?: string;
  details?: string;
  outputPath?: string;
  tmpDir?: string;
  completedAt?: number;
}

// In-memory status tracking for active render jobs
const activeJobStatuses = new Map<string, ActiveJob>();

// Clean up stale completed jobs older than 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [jobId, job] of activeJobStatuses.entries()) {
    if (job.status === 'completed' || job.status === 'error') {
      if (job.completedAt && now - job.completedAt > 10 * 60 * 1000) {
        if (job.tmpDir && fs.existsSync(job.tmpDir)) {
          try {
            fs.rmSync(job.tmpDir, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
        activeJobStatuses.delete(jobId);
      }
    }
  }
}, 60 * 1000);

async function startServer() {
  const app = express();
  // Cloud Run/AI Studio injects PORT automatically; local development falls back to 3000.
  // The user does not need to create or edit any environment variable.
  const PORT = Number.parseInt(process.env.PORT || '3000', 10);

  app.use(express.json({ limit: '1mb' }));

  // Batch uploads return as soon as the lessons enter the server queue. The
  // queue then keeps rendering even while the browser tab is backgrounded.
  registerBatchRoutes(app);

  // Status check endpoint for clients to get real pipeline stages and out_time progress
  app.get('/api/render-status/:id', (req, res) => {
    const job = activeJobStatuses.get(req.params.id);
    if (!job) {
      return res.status(404).json({ status: 'unknown' });
    }
    return res.json({
      id: job.id,
      status: job.status,
      progress: job.progress ?? 0,
      currentTimeSec: job.currentTimeSec ?? 0,
      totalDuration: job.totalDuration ?? 0,
      error: job.error,
      details: job.details,
    });
  });

  // Download endpoint for completed jobs
  app.get('/api/render-download/:id', (req, res) => {
    const job = activeJobStatuses.get(req.params.id);
    if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) {
      return res.status(404).json({ error: 'Video không tồn tại hoặc đã hết hạn.' });
    }
    const stat = fs.statSync(job.outputPath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', 'attachment; filename="video_cau_truc.mp4"');
    const stream = fs.createReadStream(job.outputPath);
    stream.pipe(res);
  });

  // POST /api/tts - for quick preview of voices (Hoài My & Jenny)
  app.post('/api/tts', async (req, res) => {
    try {
      const { text, language } = req.body;

      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ error: 'Text must not be empty' });
      }

      if (text.length > 500) {
        return res.status(400).json({ error: 'Text must not exceed 500 characters' });
      }

      if (language !== 'vi' && language !== 'en') {
        return res.status(400).json({ error: 'Language must be "vi" or "en"' });
      }

      const tempId = crypto.randomUUID();
      const tempPath = path.join(os.tmpdir(), `tts_prev_${tempId}.mp3`);

      try {
        await generateTTSFile(text.trim(), language, tempPath);
        const buffer = fs.readFileSync(tempPath);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(buffer);
      } finally {
        if (fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
          } catch {
            // ignore cleanup errors
          }
        }
      }
    } catch (err: any) {
      console.error('Edge TTS Error:', err);
      return res.status(500).json({
        error: err?.message || 'Failed to generate TTS audio',
      });
    }
  });

  // POST /api/render - Busboy streaming multipart upload and server-side video assembly
  app.post('/api/render', (req, res) => {
    // 240-second timeout for request and response
    req.setTimeout(240_000);
    res.setTimeout(240_000);

    const jobId = (req.query.jobId as string) || crypto.randomUUID();
    const tmpDir = path.join(os.tmpdir(), `render_${jobId}`);

    try {
      fs.mkdirSync(tmpDir, { recursive: true });
    } catch (e: any) {
      return res.status(500).json({ error: 'Không thể tạo thư mục tạm trên máy chủ' });
    }

    const jobRecord: ActiveJob = {
      id: jobId,
      status: 'uploading',
      progress: 0,
      tmpDir,
    };
    activeJobStatuses.set(jobId, jobRecord);

    const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MiB limit strictly enforced
    let isFileTruncated = false;
    let footagePath = '';
    let lessonData: LessonInput | null = null;
    let fileUploaded = false;
    let uploadCompleted = false;
    let isAborted = false;
    let hasResponded = false;
    const fileWritePromises: Promise<void>[] = [];

    const scheduleCleanup = (delayMs: number = 300_000) => {
      setTimeout(() => {
        try {
          if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        } catch {
          // ignore cleanup error
        }
        activeJobStatuses.delete(jobId);
      }, delayMs);
    };

    const sendError = (status: number, message: string, details?: string) => {
      if (hasResponded) return;
      hasResponded = true;
      jobRecord.status = 'error';
      jobRecord.error = message;
      jobRecord.details = details || '';
      jobRecord.completedAt = Date.now();

      if (!res.headersSent && res.writable) {
        res.status(status).json({
          error: message,
          details: details || '',
        });
      }
      scheduleCleanup(30_000);
    };

    req.on('aborted', () => {
      isAborted = true;
      if (!uploadCompleted) {
        sendError(400, 'Tải lên bị hủy bởi người dùng.');
      }
    });

    let bb: any;
    try {
      bb = busboy({
        headers: req.headers,
        limits: {
          fileSize: MAX_FILE_SIZE,
          files: 1,
        },
      });
    } catch (err: any) {
      return sendError(400, `Lỗi đọc yêu cầu: ${err.message}`);
    }

    bb.on('file', (name: string, file: any, info: any) => {
      if (name !== 'footage') {
        file.resume();
        return;
      }

      fileUploaded = true;
      const ext = path.extname(info.filename || 'clip.mp4') || '.mp4';
      footagePath = path.join(tmpDir, `footage${ext}`);
      const writeStream = fs.createWriteStream(footagePath);

      const p = new Promise<void>((resolve, reject) => {
        writeStream.on('finish', () => resolve());
        writeStream.on('error', (err) => reject(err));
      });
      fileWritePromises.push(p);

      file.on('limit', () => {
        isFileTruncated = true;
        writeStream.destroy();
      });

      file.pipe(writeStream);
    });

    bb.on('field', (name: string, val: string) => {
      if (name === 'lesson') {
        try {
          lessonData = JSON.parse(val);
        } catch {
          // parse error
        }
      }
    });

    bb.on('error', (err: any) => {
      sendError(500, `Lỗi stream tệp lên máy chủ: ${err.message}`);
    });

    bb.on('close', async () => {
      uploadCompleted = true;

      try {
        await Promise.all(fileWritePromises);
      } catch (writeErr: any) {
        return sendError(500, `Lỗi lưu tệp footage vào đĩa: ${writeErr.message}`);
      }

      if (isAborted) {
        return sendError(400, 'Yêu cầu bị hủy trong lúc tải lên.');
      }

      if (isFileTruncated) {
        return sendError(
          400,
          'Tệp footage vượt quá giới hạn tối đa 25 MiB. Vui lòng chọn clip có dung lượng nhỏ hơn.'
        );
      }

      if (!fileUploaded || !footagePath || !fs.existsSync(footagePath)) {
        return sendError(400, 'Không tìm thấy tệp footage trong yêu cầu gửi lên.');
      }

      const footageStat = fs.statSync(footagePath);
      if (footageStat.size > MAX_FILE_SIZE) {
        return sendError(
          400,
          'Tệp footage vượt quá giới hạn tối đa 25 MiB. Vui lòng chọn clip có dung lượng nhỏ hơn.'
        );
      }

      if (footageStat.size === 0) {
        return sendError(400, 'Tệp footage tải lên rỗng (0 bytes).');
      }

      if (!lessonData || !lessonData.structure || !Array.isArray(lessonData.pairs) || lessonData.pairs.length !== 3) {
        return sendError(400, 'Dữ liệu bài học không đúng cấu trúc (cần cấu trúc và đúng 3 cặp câu).');
      }

      // Execute real render pipeline in background
      // Note: Do NOT kill FFmpeg if HTTP request emits 'close' after upload has completed.
      try {
        const result = await runServerRenderPipeline({
          tmpDir,
          footagePath,
          lesson: lessonData,
          onStatus: (st) => {
            jobRecord.status = st;
          },
          onProgress: (p) => {
            jobRecord.progress = p.percent;
            jobRecord.currentTimeSec = p.currentTimeSec;
            jobRecord.totalDuration = p.totalDuration;
          },
        });

        if (!fs.existsSync(result.outputPath)) {
          throw new Error('Tệp video đầu ra không tồn tại sau render.');
        }

        const outStat = fs.statSync(result.outputPath);
        jobRecord.status = 'streaming';
        jobRecord.outputPath = result.outputPath;
        jobRecord.completedAt = Date.now();

        // If client connection is still open and writable, stream the file
        if (!hasResponded && !res.headersSent && res.writable && !res.destroyed) {
          hasResponded = true;
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Length', outStat.size);
          res.setHeader('Content-Disposition', 'attachment; filename="video_cau_truc.mp4"');

          const readStream = fs.createReadStream(result.outputPath);

          readStream.on('end', () => {
            jobRecord.status = 'completed';
            scheduleCleanup(60_000);
          });

          readStream.on('error', (streamErr) => {
            console.error('Stream error:', streamErr);
            scheduleCleanup(30_000);
          });

          readStream.pipe(res);
        } else {
          // Connection was closed by client or proxy, but video is ready!
          jobRecord.status = 'completed';
          scheduleCleanup(600_000); // keep for 10 minutes so client can download via GET /api/render-download/:id
        }
      } catch (pipelineErr: any) {
        console.error('Pipeline Error:', pipelineErr);
        sendError(
          500,
          pipelineErr.message || 'Lỗi xử lý dựng video trên máy chủ.',
          pipelineErr.stack || ''
        );
      }
    });

    req.pipe(bb);
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'video-cau-truc-anh-viet' });
  });

  // Vite middleware for development or static serving for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });

  // Set 240-second timeout on HTTP Server
  server.setTimeout(240_000);
  server.headersTimeout = 245_000;
  server.requestTimeout = 240_000;
  server.keepAliveTimeout = 65_000;
}

startServer();
