import type { FootageRecord, ParsedLesson } from '../types';

export type ServerBatchStatus =
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'completed_with_errors'
  | 'error';

export type ServerBatchItemStatus = 'queued' | 'generating_tts' | 'rendering_video' | 'completed' | 'error';

export interface ServerBatchItem {
  id: string;
  index: number;
  structure: string;
  footageName: string;
  status: ServerBatchItemStatus;
  stage: string;
  progress: number;
  currentTimeSec: number;
  totalDuration: number;
  duration?: number;
  outputSize?: number;
  downloadReady: boolean;
  error?: string;
  details?: string;
}

export interface ServerBatch {
  id: string;
  status: ServerBatchStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  expiresAt?: string;
  total: number;
  completed: number;
  failed: number;
  overallProgress: number;
  error?: string;
  details?: string;
  canDownloadAll: boolean;
  items: ServerBatchItem[];
}

export interface BatchUploadProgress {
  percent: number;
  loaded: number;
  total: number;
}

const ACTIVE_BATCH_KEY = 'video-cau-truc-active-batch-v2';
const MAX_FOOTAGE_SIZE = 25 * 1024 * 1024;

export function createBatchId(): string {
  return crypto.randomUUID();
}

export function rememberActiveBatch(batchId: string): void {
  try {
    localStorage.setItem(ACTIVE_BATCH_KEY, batchId);
  } catch {
    // Status can still be followed for the current page lifetime.
  }
}

export function getRememberedBatch(): string | null {
  try {
    return localStorage.getItem(ACTIVE_BATCH_KEY);
  } catch {
    return null;
  }
}

export function forgetActiveBatch(): void {
  try {
    localStorage.removeItem(ACTIVE_BATCH_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

export function isBatchTerminal(status: ServerBatchStatus): boolean {
  return status === 'completed' || status === 'completed_with_errors' || status === 'error';
}

export async function fetchBatchStatus(batchId: string): Promise<ServerBatch | null> {
  const response = await fetch(`/api/render-batches/${encodeURIComponent(batchId)}`, {
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Không lấy được tiến độ lô (HTTP ${response.status}).`);
  return response.json();
}

export function itemDownloadUrl(batchId: string, itemId: string, inline = false): string {
  const suffix = inline ? '?inline=1' : '';
  return `/api/render-batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/download${suffix}`;
}

export function batchDownloadUrl(batchId: string): string {
  return `/api/render-batches/${encodeURIComponent(batchId)}/download-all`;
}

export async function uploadRenderBatch(
  batchId: string,
  lessons: ParsedLesson[],
  activeFootages: FootageRecord[],
  onProgress?: (progress: BatchUploadProgress) => void
): Promise<{ batchId: string; status: string; total: number }> {
  if (lessons.length === 0) throw new Error('Chưa có bài học để dựng.');
  if (lessons.length > 100) throw new Error('Mỗi lô tối đa 100 bài.');

  const usableFootages = activeFootages.filter(
    (footage) => footage.active && footage.blob && footage.blob.size > 0 && footage.blob.size <= MAX_FOOTAGE_SIZE
  );
  if (usableFootages.length === 0) {
    throw new Error('Không có footage đang bật nào hợp lệ (mỗi clip phải nhỏ hơn hoặc bằng 25 MiB).');
  }

  const selected = lessons.map(
    () => usableFootages[Math.floor(Math.random() * usableFootages.length)]
  );
  const keyByFootageId = new Map<string, string>();
  const uniqueFootages: Array<{ key: string; footage: FootageRecord }> = [];

  for (const footage of selected) {
    if (!keyByFootageId.has(footage.id)) {
      const key = `footage_${uniqueFootages.length}`;
      keyByFootageId.set(footage.id, key);
      uniqueFootages.push({ key, footage });
    }
  }

  const manifest = {
    lessons: lessons.map((lesson, index) => ({
      lesson,
      footageKey: keyByFootageId.get(selected[index].id),
      footageName: selected[index].originalName || 'footage.mp4',
    })),
  };

  const formData = new FormData();
  formData.append('manifest', JSON.stringify(manifest));
  for (const { key, footage } of uniqueFootages) {
    formData.append(key, footage.blob, footage.originalName || `${key}.mp4`);
  }

  rememberActiveBatch(batchId);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/render-batches?batchId=${encodeURIComponent(batchId)}`, true);
    xhr.responseType = 'json';
    xhr.timeout = 10 * 60 * 1000;

    const recoverKnownBatch = async (fallbackMessage: string) => {
      try {
        const known = await fetchBatchStatus(batchId);
        if (known && known.status !== 'error') {
          resolve({ batchId, status: known.status, total: known.total });
          return;
        }
        if (known?.error) {
          reject(new Error(known.error));
          return;
        }
      } catch {
        // Use the original transport error below.
      }
      reject(new Error(fallbackMessage));
    };

    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : 0;
      onProgress?.({
        percent: total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0,
        loaded: event.loaded,
        total,
      });
    };

    xhr.onload = () => {
      const response = xhr.response as { batchId?: string; status?: string; total?: number; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && response?.batchId) {
        resolve({
          batchId: response.batchId,
          status: response.status || 'queued',
          total: response.total || lessons.length,
        });
        return;
      }
      if (xhr.status === 409) {
        void recoverKnownBatch(response?.error || 'Lô này đã tồn tại.');
        return;
      }
      reject(new Error(response?.error || `Không thể gửi lô lên máy chủ (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => void recoverKnownBatch('Mất kết nối trong lúc tải lô lên máy chủ.');
    xhr.ontimeout = () => void recoverKnownBatch('Quá thời gian tải lô lên máy chủ.');
    xhr.onabort = () => void recoverKnownBatch('Yêu cầu tải lô đã bị hủy.');
    xhr.send(formData);
  });
}
