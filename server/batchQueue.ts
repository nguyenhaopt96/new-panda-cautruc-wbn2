import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import busboy from 'busboy';
import { runServerRenderPipeline, type LessonInput } from './renderPipeline';
import { createStoredZip } from './storeZip';

type BatchStatus = 'uploading' | 'queued' | 'processing' | 'completed' | 'completed_with_errors' | 'error';
type BatchItemStatus = 'queued' | 'generating_tts' | 'rendering_video' | 'completed' | 'error';

interface BatchManifestItem {
  lesson: LessonInput;
  footageKey: string;
  footageName: string;
}

interface BatchItem {
  id: string;
  index: number;
  structure: string;
  lesson: LessonInput;
  footageKey: string;
  footageName: string;
  status: BatchItemStatus;
  progress: number;
  currentTimeSec: number;
  totalDuration: number;
  outputPath?: string;
  outputName?: string;
  outputSize?: number;
  duration?: number;
  error?: string;
  details?: string;
}

interface BatchJob {
  id: string;
  status: BatchStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  tmpDir: string;
  uploadedFootages: Record<string, string>;
  items: BatchItem[];
  error?: string;
  details?: string;
  zipPath?: string;
}

const MAX_BATCH_ITEMS = 100;
const MAX_FOOTAGE_FILES = 100;
const MAX_FOOTAGE_SIZE = 25 * 1024 * 1024;
const MAX_MANIFEST_SIZE = 2 * 1024 * 1024;
const TERMINAL_RETENTION_MS = 6 * 60 * 60 * 1000;
// PandaStack preserves the app workspace across process restarts and
// sleep/wake cycles. Keeping batch state here lets the queue recover after a
// Node restart; the folder is ignored by git and never included in builds.
const BATCH_ROOT = path.join(process.cwd(), '.runtime', 'video_cau_truc_batches');
const BATCH_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const FOOTAGE_KEY_PATTERN = /^footage_\d+$/;

const batches = new Map<string, BatchJob>();
const batchQueue: string[] = [];
const zipPromises = new Map<string, Promise<string>>();
let queueWorkerRunning = false;
let recovered = false;

function isTerminal(status: BatchStatus): boolean {
  return status === 'completed' || status === 'completed_with_errors' || status === 'error';
}

function statePath(batch: BatchJob): string {
  return path.join(batch.tmpDir, 'batch-state.json');
}

function persistBatch(batch: BatchJob): void {
  try {
    fs.mkdirSync(batch.tmpDir, { recursive: true });
    const destination = statePath(batch);
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(batch), 'utf8');
    fs.renameSync(temporary, destination);
  } catch (error) {
    console.warn('Could not persist batch state:', error);
  }
}

function removeBatch(batchId: string): void {
  const batch = batches.get(batchId);
  if (!batch) return;
  batches.delete(batchId);
  zipPromises.delete(batchId);
  try {
    fs.rmSync(batch.tmpDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
}

function recoverExistingBatches(): void {
  if (recovered) return;
  recovered = true;
  fs.mkdirSync(BATCH_ROOT, { recursive: true });

  for (const directory of fs.readdirSync(BATCH_ROOT, { withFileTypes: true })) {
    if (!directory.isDirectory() || !BATCH_ID_PATTERN.test(directory.name)) continue;
    const batchDir = path.join(BATCH_ROOT, directory.name);
    const savedState = path.join(batchDir, 'batch-state.json');
    try {
      const batch = JSON.parse(fs.readFileSync(savedState, 'utf8')) as BatchJob;
      if (!batch || batch.id !== directory.name || !Array.isArray(batch.items)) throw new Error('Invalid state');
      batch.tmpDir = batchDir;

      if (isTerminal(batch.status)) {
        const finishedAt = batch.completedAt || batch.updatedAt || batch.createdAt;
        if (Date.now() - finishedAt > TERMINAL_RETENTION_MS) {
          fs.rmSync(batchDir, { recursive: true, force: true });
          continue;
        }
        batches.set(batch.id, batch);
        continue;
      }

      if (batch.status === 'uploading') {
        batch.status = 'error';
        batch.error = 'Lần tải lô trước bị gián đoạn trước khi vào hàng đợi máy chủ.';
        batch.completedAt = Date.now();
        batch.updatedAt = Date.now();
        batches.set(batch.id, batch);
        persistBatch(batch);
        continue;
      }

      for (const item of batch.items) {
        if (item.status === 'completed' && item.outputPath && fs.existsSync(item.outputPath)) continue;
        item.status = 'queued';
        item.progress = 0;
        item.currentTimeSec = 0;
        item.totalDuration = 0;
        delete item.error;
        delete item.details;
        delete item.outputPath;
      }
      batch.status = 'queued';
      batch.updatedAt = Date.now();
      batches.set(batch.id, batch);
      batchQueue.push(batch.id);
      persistBatch(batch);
    } catch {
      try {
        fs.rmSync(batchDir, { recursive: true, force: true });
      } catch {
        // Ignore invalid stale state.
      }
    }
  }

  if (batchQueue.length > 0) setImmediate(() => void drainBatchQueue());
}

function validateLesson(value: unknown, itemNumber: number): LessonInput {
  if (!value || typeof value !== 'object') throw new Error(`Bài ${itemNumber} không có dữ liệu hợp lệ.`);
  const source = value as Record<string, unknown>;
  const structure = typeof source.structure === 'string' ? source.structure.trim() : '';
  const explanation = typeof source.explanation === 'string' ? source.explanation.trim() : '';
  const sourcePairs = Array.isArray(source.pairs) ? source.pairs : [];

  if (!structure) throw new Error(`Bài ${itemNumber} thiếu cấu trúc.`);
  if (structure.length > 300) throw new Error(`Cấu trúc của bài ${itemNumber} quá dài.`);
  if (explanation.length > 800) throw new Error(`Giải thích của bài ${itemNumber} quá dài.`);
  if (sourcePairs.length !== 3) throw new Error(`Bài ${itemNumber} phải có đúng 3 cặp câu.`);

  const pairs = sourcePairs.map((pair, pairIndex) => {
    if (!pair || typeof pair !== 'object') throw new Error(`Cặp ${pairIndex + 1} của bài ${itemNumber} không hợp lệ.`);
    const pairValue = pair as Record<string, unknown>;
    const vi = typeof pairValue.vi === 'string' ? pairValue.vi.trim() : '';
    const en = typeof pairValue.en === 'string' ? pairValue.en.trim() : '';
    if (!vi || !en) throw new Error(`Cặp ${pairIndex + 1} của bài ${itemNumber} đang để trống.`);
    if (vi.length > 600 || en.length > 600) throw new Error(`Cặp ${pairIndex + 1} của bài ${itemNumber} quá dài.`);
    return { vi, en };
  });

  return { structure, explanation, pairs };
}

function parseManifest(rawManifest: string | undefined): BatchManifestItem[] {
  if (!rawManifest) throw new Error('Không tìm thấy danh sách bài học.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest);
  } catch {
    throw new Error('Danh sách bài học không phải JSON hợp lệ.');
  }

  const source = parsed as { lessons?: unknown };
  if (!source || !Array.isArray(source.lessons)) throw new Error('Danh sách bài học không đúng cấu trúc.');
  if (source.lessons.length === 0) throw new Error('Lô chưa có bài học nào.');
  if (source.lessons.length > MAX_BATCH_ITEMS) {
    throw new Error(`Mỗi lô tối đa ${MAX_BATCH_ITEMS} bài.`);
  }

  return source.lessons.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Bài ${index + 1} không hợp lệ.`);
    const item = entry as Record<string, unknown>;
    const footageKey = typeof item.footageKey === 'string' ? item.footageKey : '';
    const footageName = typeof item.footageName === 'string' ? item.footageName.slice(0, 240) : 'footage.mp4';
    if (!FOOTAGE_KEY_PATTERN.test(footageKey)) {
      throw new Error(`Bài ${index + 1} không tham chiếu footage hợp lệ.`);
    }
    return {
      lesson: validateLesson(item.lesson, index + 1),
      footageKey,
      footageName,
    };
  });
}

function safeOutputStem(structure: string): string {
  const normalized = structure
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 64);
  return normalized || 'video_cau_truc';
}

function stageLabel(status: BatchItemStatus): string {
  if (status === 'generating_tts') return 'Đang tạo sáu giọng đọc';
  if (status === 'rendering_video') return 'Đang dựng video';
  if (status === 'completed') return 'Đã hoàn tất';
  if (status === 'error') return 'Bị lỗi';
  return 'Đang chờ';
}

function statusPayload(batch: BatchJob) {
  const completed = batch.items.filter((item) => item.status === 'completed').length;
  const failed = batch.items.filter((item) => item.status === 'error').length;
  const settled = completed + failed;
  const activeProgress = batch.items
    .filter((item) => item.status === 'generating_tts' || item.status === 'rendering_video')
    .reduce((sum, item) => sum + item.progress / 100, 0);
  const overallProgress = batch.items.length > 0
    ? Math.min(100, Math.round(((settled + activeProgress) / batch.items.length) * 100))
    : 0;

  return {
    id: batch.id,
    status: batch.status,
    createdAt: new Date(batch.createdAt).toISOString(),
    updatedAt: new Date(batch.updatedAt).toISOString(),
    completedAt: batch.completedAt ? new Date(batch.completedAt).toISOString() : undefined,
    expiresAt: batch.completedAt
      ? new Date(batch.completedAt + TERMINAL_RETENTION_MS).toISOString()
      : undefined,
    total: batch.items.length,
    completed,
    failed,
    overallProgress,
    error: batch.error,
    details: batch.details,
    canDownloadAll: isTerminal(batch.status) && completed > 0,
    items: batch.items.map((item) => ({
      id: item.id,
      index: item.index,
      structure: item.structure,
      footageName: item.footageName,
      status: item.status,
      stage: stageLabel(item.status),
      progress: item.progress,
      currentTimeSec: item.currentTimeSec,
      totalDuration: item.totalDuration,
      duration: item.duration,
      outputSize: item.outputSize,
      downloadReady: item.status === 'completed' && Boolean(item.outputPath && fs.existsSync(item.outputPath)),
      error: item.error,
      details: item.details,
    })),
  };
}

async function processBatch(batch: BatchJob): Promise<void> {
  batch.status = 'processing';
  batch.updatedAt = Date.now();
  persistBatch(batch);

  for (const item of batch.items) {
    if (item.status === 'completed' && item.outputPath && fs.existsSync(item.outputPath)) continue;

    const footagePath = batch.uploadedFootages[item.footageKey];
    if (!footagePath || !fs.existsSync(footagePath)) {
      item.status = 'error';
      item.error = 'Footage của bài này không còn trên máy chủ.';
      item.progress = 0;
      batch.updatedAt = Date.now();
      persistBatch(batch);
      continue;
    }

    const itemDir = path.join(batch.tmpDir, 'working', String(item.index).padStart(3, '0'));
    try {
      fs.rmSync(itemDir, { recursive: true, force: true });
      fs.mkdirSync(itemDir, { recursive: true });
      item.status = 'generating_tts';
      item.progress = 0;
      item.currentTimeSec = 0;
      item.totalDuration = 0;
      delete item.error;
      delete item.details;
      batch.updatedAt = Date.now();
      persistBatch(batch);

      const result = await runServerRenderPipeline({
        tmpDir: itemDir,
        footagePath,
        lesson: item.lesson,
        onStatus: (status) => {
          item.status = status === 'rendering_video' || status === 'streaming' ? 'rendering_video' : 'generating_tts';
          batch.updatedAt = Date.now();
        },
        onProgress: (progress) => {
          item.progress = progress.percent;
          item.currentTimeSec = progress.currentTimeSec;
          item.totalDuration = progress.totalDuration;
          batch.updatedAt = Date.now();
        },
      });

      const outputDir = path.join(batch.tmpDir, 'outputs');
      fs.mkdirSync(outputDir, { recursive: true });
      const outputName = `${String(item.index).padStart(2, '0')}_${safeOutputStem(item.structure)}.mp4`;
      const finalPath = path.join(outputDir, outputName);
      fs.renameSync(result.outputPath, finalPath);
      const stat = fs.statSync(finalPath);

      item.status = 'completed';
      item.progress = 100;
      item.currentTimeSec = result.duration;
      item.totalDuration = result.duration;
      item.duration = result.duration;
      item.outputPath = finalPath;
      item.outputName = outputName;
      item.outputSize = stat.size;
      batch.updatedAt = Date.now();
      persistBatch(batch);
    } catch (error: any) {
      item.status = 'error';
      item.progress = 0;
      item.error = error?.message || 'Không dựng được video này.';
      item.details = error?.stack || '';
      batch.updatedAt = Date.now();
      persistBatch(batch);
    } finally {
      try {
        fs.rmSync(itemDir, { recursive: true, force: true });
      } catch {
        // Keep processing the remaining lessons.
      }
    }
  }

  const failed = batch.items.filter((item) => item.status === 'error').length;
  batch.status = failed === 0 ? 'completed' : 'completed_with_errors';
  batch.completedAt = Date.now();
  batch.updatedAt = batch.completedAt;
  persistBatch(batch);
}

async function drainBatchQueue(): Promise<void> {
  if (queueWorkerRunning) return;
  queueWorkerRunning = true;
  try {
    while (batchQueue.length > 0) {
      const batchId = batchQueue.shift();
      if (!batchId) continue;
      const batch = batches.get(batchId);
      if (!batch || batch.status !== 'queued') continue;
      try {
        await processBatch(batch);
      } catch (error: any) {
        batch.status = 'error';
        batch.error = error?.message || 'Hàng đợi máy chủ gặp lỗi.';
        batch.details = error?.stack || '';
        batch.completedAt = Date.now();
        batch.updatedAt = batch.completedAt;
        persistBatch(batch);
      }
    }
  } finally {
    queueWorkerRunning = false;
    if (batchQueue.length > 0) setImmediate(() => void drainBatchQueue());
  }
}

function enqueueBatch(batch: BatchJob): void {
  batch.status = 'queued';
  batch.updatedAt = Date.now();
  persistBatch(batch);
  batchQueue.push(batch.id);
  setImmediate(() => void drainBatchQueue());
}

function sendFile(res: Response, filePath: string, downloadName: string, inline = false): void {
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', filePath.endsWith('.zip') ? 'application/zip' : 'video/mp4');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${downloadName.replace(/["\\]/g, '_')}"`);
  fs.createReadStream(filePath).pipe(res);
}

function failUpload(batch: BatchJob, res: Response, status: number, message: string, details?: string): void {
  batch.status = 'error';
  batch.error = message;
  batch.details = details;
  batch.completedAt = Date.now();
  batch.updatedAt = batch.completedAt;
  persistBatch(batch);
  if (!res.headersSent && !res.writableEnded && !res.destroyed) {
    res.status(status).json({ error: message, details });
  }
}

function registerCreateBatchRoute(app: Express): void {
  app.post('/api/render-batches', (req: Request, res: Response) => {
    req.setTimeout(10 * 60 * 1000);
    res.setTimeout(10 * 60 * 1000);

    const requestedId = typeof req.query.batchId === 'string' ? req.query.batchId : '';
    const batchId = requestedId || crypto.randomUUID();
    if (!BATCH_ID_PATTERN.test(batchId)) {
      return res.status(400).json({ error: 'Mã lô không hợp lệ.' });
    }
    if (batches.has(batchId)) {
      return res.status(409).json({ error: 'Lô này đã tồn tại.', batchId });
    }

    const tmpDir = path.join(BATCH_ROOT, batchId);
    try {
      fs.mkdirSync(tmpDir, { recursive: false });
    } catch {
      return res.status(409).json({ error: 'Không thể tạo thư mục cho lô này.' });
    }

    const batch: BatchJob = {
      id: batchId,
      status: 'uploading',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tmpDir,
      uploadedFootages: {},
      items: [],
    };
    batches.set(batchId, batch);
    persistBatch(batch);

    let rawManifest: string | undefined;
    let uploadIssue: string | undefined;
    let requestAborted = false;
    const truncatedFields = new Set<string>();
    const writePromises: Promise<void>[] = [];

    let parser: ReturnType<typeof busboy>;
    try {
      parser = busboy({
        headers: req.headers,
        limits: {
          fileSize: MAX_FOOTAGE_SIZE,
          files: MAX_FOOTAGE_FILES,
          fields: 1,
          fieldSize: MAX_MANIFEST_SIZE,
        },
      });
    } catch (error: any) {
      failUpload(batch, res, 400, `Không đọc được yêu cầu tải lên: ${error?.message || 'lỗi không xác định'}`);
      return;
    }

    req.on('aborted', () => {
      requestAborted = true;
      if (batch.status === 'uploading') {
        failUpload(batch, res, 400, 'Tải lô bị gián đoạn trước khi vào hàng đợi máy chủ.');
      }
    });

    parser.on('file', (fieldName: string, file: NodeJS.ReadableStream, info: { filename: string }) => {
      if (!FOOTAGE_KEY_PATTERN.test(fieldName)) {
        file.resume();
        uploadIssue = 'Yêu cầu chứa trường footage không hợp lệ.';
        return;
      }
      if (batch.uploadedFootages[fieldName]) {
        file.resume();
        uploadIssue = `Footage ${fieldName} bị gửi lặp.`;
        return;
      }

      const sourceExtension = path.extname(info.filename || '').toLowerCase();
      const extension = /^\.[a-z0-9]{1,8}$/.test(sourceExtension) ? sourceExtension : '.mp4';
      const destination = path.join(tmpDir, `${fieldName}${extension}`);
      batch.uploadedFootages[fieldName] = destination;
      const output = fs.createWriteStream(destination);

      writePromises.push(new Promise<void>((resolve, reject) => {
        output.once('finish', resolve);
        output.once('error', reject);
        file.once('error', reject);
      }));
      file.on('limit', () => truncatedFields.add(fieldName));
      file.pipe(output);
    });

    parser.on('field', (fieldName: string, value: string, info: { valueTruncated?: boolean }) => {
      if (fieldName !== 'manifest') {
        uploadIssue = 'Yêu cầu chứa trường văn bản không hợp lệ.';
        return;
      }
      if (info?.valueTruncated) {
        uploadIssue = 'Danh sách bài học vượt quá giới hạn dung lượng.';
        return;
      }
      rawManifest = value;
    });

    parser.on('filesLimit', () => {
      uploadIssue = `Mỗi lô chỉ được dùng tối đa ${MAX_FOOTAGE_FILES} footage.`;
    });
    parser.on('fieldsLimit', () => {
      uploadIssue = 'Yêu cầu có quá nhiều trường văn bản.';
    });
    parser.on('error', (error: Error) => {
      uploadIssue = `Lỗi đọc dữ liệu tải lên: ${error.message}`;
    });

    parser.on('close', async () => {
      try {
        await Promise.all(writePromises);
        if (requestAborted) return;
        if (uploadIssue) return failUpload(batch, res, 400, uploadIssue);
        if (truncatedFields.size > 0) {
          return failUpload(batch, res, 400, 'Có footage vượt quá giới hạn 25 MiB.');
        }

        const manifest = parseManifest(rawManifest);
        for (const manifestItem of manifest) {
          const uploadedPath = batch.uploadedFootages[manifestItem.footageKey];
          if (!uploadedPath || !fs.existsSync(uploadedPath)) {
            throw new Error(`Thiếu footage cho bài ${manifest.indexOf(manifestItem) + 1}.`);
          }
          const stat = fs.statSync(uploadedPath);
          if (stat.size === 0) throw new Error('Có footage rỗng (0 byte).');
          if (stat.size > MAX_FOOTAGE_SIZE) throw new Error('Có footage vượt quá giới hạn 25 MiB.');
        }

        batch.items = manifest.map((manifestItem, index) => ({
          id: crypto.randomUUID(),
          index: index + 1,
          structure: manifestItem.lesson.structure,
          lesson: manifestItem.lesson,
          footageKey: manifestItem.footageKey,
          footageName: manifestItem.footageName,
          status: 'queued',
          progress: 0,
          currentTimeSec: 0,
          totalDuration: 0,
        }));

        enqueueBatch(batch);
        if (!res.headersSent && !res.writableEnded && !res.destroyed) {
          res.status(202).json({ batchId: batch.id, status: 'queued', total: batch.items.length });
        }
      } catch (error: any) {
        failUpload(batch, res, 400, error?.message || 'Dữ liệu lô không hợp lệ.', error?.stack || '');
      }
    });

    req.pipe(parser);
  });
}

export function registerBatchRoutes(app: Express): void {
  recoverExistingBatches();
  registerCreateBatchRoute(app);

  app.get('/api/render-batches/:batchId', (req, res) => {
    const batch = batches.get(req.params.batchId);
    if (!batch) return res.status(404).json({ status: 'unknown', error: 'Không tìm thấy lô hoặc kết quả đã hết hạn.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json(statusPayload(batch));
  });

  app.get('/api/render-batches/:batchId/items/:itemId/download', (req, res) => {
    const batch = batches.get(req.params.batchId);
    const item = batch?.items.find((candidate) => candidate.id === req.params.itemId);
    if (!batch || !item || item.status !== 'completed' || !item.outputPath || !fs.existsSync(item.outputPath)) {
      return res.status(404).json({ error: 'Video không tồn tại, chưa hoàn tất hoặc đã hết hạn.' });
    }
    sendFile(res, item.outputPath, item.outputName || `${String(item.index).padStart(2, '0')}_video.mp4`, req.query.inline === '1');
  });

  app.get('/api/render-batches/:batchId/download-all', async (req, res) => {
    const batch = batches.get(req.params.batchId);
    if (!batch || !isTerminal(batch.status)) {
      return res.status(409).json({ error: 'Lô chưa hoàn tất.' });
    }
    const completedItems = batch.items.filter(
      (item) => item.status === 'completed' && item.outputPath && fs.existsSync(item.outputPath)
    );
    if (completedItems.length === 0) return res.status(404).json({ error: 'Lô không có video thành công.' });

    try {
      let zipPath = batch.zipPath;
      if (!zipPath || !fs.existsSync(zipPath)) {
        let zipPromise = zipPromises.get(batch.id);
        if (!zipPromise) {
          zipPath = path.join(batch.tmpDir, `video_cau_truc_${batch.id.slice(0, 8)}.zip`);
          const target = zipPath;
          zipPromise = createStoredZip(
            completedItems.map((item) => ({
              sourcePath: item.outputPath as string,
              name: item.outputName || `${String(item.index).padStart(2, '0')}_video.mp4`,
            })),
            target
          ).then(() => target);
          zipPromises.set(batch.id, zipPromise);
        }
        zipPath = await zipPromise;
        batch.zipPath = zipPath;
        batch.updatedAt = Date.now();
        persistBatch(batch);
        zipPromises.delete(batch.id);
      }
      sendFile(res, zipPath, 'tat_ca_video.zip');
    } catch (error: any) {
      zipPromises.delete(batch.id);
      if (!res.headersSent) res.status(500).json({ error: error?.message || 'Không thể đóng tệp ZIP.' });
    }
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [batchId, batch] of batches.entries()) {
    if (!isTerminal(batch.status)) continue;
    const finishedAt = batch.completedAt || batch.updatedAt || batch.createdAt;
    if (now - finishedAt > TERMINAL_RETENTION_MS) removeBatch(batchId);
  }
}, 60 * 1000).unref();
