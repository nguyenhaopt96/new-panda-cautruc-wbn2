import { FootageRecord, JobRecord, ParsedLesson } from '../types';
import { saveJob, saveOutput } from './db';

export type RenderStage = string;

export interface RenderResult {
  job: JobRecord;
  mp4Blob: Blob;
}

const MAX_FOOTAGE_SIZE = 25 * 1024 * 1024; // 25 MiB

export async function renderVideoLesson(
  lesson: ParsedLesson,
  activeFootageList: FootageRecord[],
  onStageChange: (stage: RenderStage) => void
): Promise<RenderResult> {
  if (activeFootageList.length === 0) {
    throw new Error('Chưa có footage nào được chọn. Vui lòng kích hoạt ít nhất 1 footage.');
  }

  // Pick exactly 1 active footage randomly
  const randomIndex = Math.floor(Math.random() * activeFootageList.length);
  const selectedFootage = activeFootageList[randomIndex];

  if (!selectedFootage || !selectedFootage.blob) {
    throw new Error('Footage đã chọn không có dữ liệu tệp hợp lệ.');
  }

  // Validate footage size (max 25 MiB)
  const footageSize = selectedFootage.blob.size;
  if (footageSize > MAX_FOOTAGE_SIZE) {
    const sizeMiB = (footageSize / (1024 * 1024)).toFixed(2);
    throw new Error(
      `Tệp footage vượt quá giới hạn tối đa 25 MiB (dung lượng hiện tại: ${sizeMiB} MiB). Vui lòng chọn hoặc tải lên clip có dung lượng nhỏ hơn.`
    );
  }

  const jobId = crypto.randomUUID();
  onStageChange('Đang tải footage lên máy chủ');

  // Build FormData with footage and lesson
  const formData = new FormData();
  formData.append('footage', selectedFootage.blob, selectedFootage.originalName || 'footage.mp4');
  formData.append(
    'lesson',
    JSON.stringify({
      structure: lesson.structure,
      explanation: lesson.explanation,
      pairs: lesson.pairs,
    })
  );

  return new Promise<RenderResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/render?jobId=${encodeURIComponent(jobId)}`, true);
    xhr.responseType = 'blob';
    xhr.timeout = 240_000; // 240 seconds client timeout

    let statusPollTimer: any = null;
    let isFinished = false;

    const stopPolling = () => {
      if (statusPollTimer) {
        clearInterval(statusPollTimer);
        statusPollTimer = null;
      }
    };

    // Track upload progress
    xhr.upload.onprogress = () => {
      onStageChange('Đang tải footage lên máy chủ');
    };

    // When upload finishes, start checking real server status & progress
    xhr.upload.onload = () => {
      onStageChange('Đang tạo sáu giọng đọc');

      statusPollTimer = setInterval(async () => {
        if (isFinished) return;
        try {
          const res = await fetch(`/api/render-status/${encodeURIComponent(jobId)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'generating_tts') {
              onStageChange('Đang tạo sáu giọng đọc');
            } else if (data.status === 'rendering_video') {
              if (data.totalDuration && data.totalDuration > 0 && typeof data.currentTimeSec === 'number') {
                const curSec = data.currentTimeSec.toFixed(1);
                const totSec = data.totalDuration.toFixed(1);
                const pct = data.progress ?? 0;
                onStageChange(`Đang dựng video: ${pct}% (${curSec}s / ${totSec}s)`);
              } else {
                onStageChange('Đang dựng video');
              }
            } else if (data.status === 'streaming') {
              onStageChange('Đang tải kết quả');
            } else if (data.status === 'error') {
              stopPolling();
              isFinished = true;
              xhr.abort();
              const fullErr = data.details
                ? `${data.error}\n\nChi tiết kỹ thuật (FFmpeg stderr):\n${data.details}`
                : data.error || 'Lỗi dựng video trên máy chủ.';
              reject(new Error(fullErr));
            }
          }
        } catch {
          // ignore network polling error
        }
      }, 500);
    };

    // Download progress
    xhr.onprogress = () => {
      onStageChange('Đang tải kết quả');
    };

    xhr.onload = async () => {
      if (isFinished) return;
      isFinished = true;
      stopPolling();

      if (xhr.status >= 200 && xhr.status < 300) {
        const mp4Blob = xhr.response as Blob;
        if (!mp4Blob || mp4Blob.size === 0) {
          return reject(new Error('Máy chủ trả về tệp video rỗng (0 bytes).'));
        }

        const jobRecord: JobRecord = {
          id: jobId,
          createdAt: new Date().toISOString(),
          structure: lesson.structure,
          pairs: lesson.pairs,
          voiceIds: {
            vi: 'vi-VN-HoaiMyNeural',
            en: 'en-US-JennyNeural',
          },
          footageId: selectedFootage.id,
          footageName: selectedFootage.originalName,
          timeline: {
            totalDuration: 0,
            pairs: [],
          },
          duration: 0,
          fileSize: mp4Blob.size,
          status: 'passed',
          hasSavedOutput: true,
        };

        try {
          await saveJob(jobRecord);
          await saveOutput({
            id: crypto.randomUUID(),
            jobId,
            blob: mp4Blob,
            size: mp4Blob.size,
            createdAt: new Date().toISOString(),
          });
        } catch (dbErr) {
          console.warn('Could not cache output to IndexedDB:', dbErr);
        }

        resolve({ job: jobRecord, mp4Blob });
      } else {
        // Read error JSON from blob response
        try {
          const errorText = await (xhr.response as Blob).text();
          const errorJson = JSON.parse(errorText);
          const fullMessage = errorJson.details
            ? `${errorJson.error}\n\nChi tiết kỹ thuật (FFmpeg stderr):\n${errorJson.details}`
            : errorJson.error || `Máy chủ báo lỗi ${xhr.status}`;
          reject(new Error(fullMessage));
        } catch {
          reject(new Error(`Quá trình dựng video thất bại với mã lỗi HTTP ${xhr.status}.`));
        }
      }
    };

    xhr.ontimeout = async () => {
      if (isFinished) return;
      isFinished = true;
      stopPolling();

      // Check if job actually completed on the server
      try {
        const checkRes = await fetch(`/api/render-status/${encodeURIComponent(jobId)}`);
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.status === 'completed') {
            const dlRes = await fetch(`/api/render-download/${encodeURIComponent(jobId)}`);
            if (dlRes.ok) {
              const mp4Blob = await dlRes.blob();
              return resolve({
                job: {
                  id: jobId,
                  createdAt: new Date().toISOString(),
                  structure: lesson.structure,
                  pairs: lesson.pairs,
                  voiceIds: { vi: 'vi-VN-HoaiMyNeural', en: 'en-US-JennyNeural' },
                  footageId: selectedFootage.id,
                  footageName: selectedFootage.originalName,
                  timeline: { totalDuration: 0, pairs: [] },
                  duration: 0,
                  fileSize: mp4Blob.size,
                  status: 'passed',
                  hasSavedOutput: true,
                },
                mp4Blob,
              });
            }
          }
        }
      } catch {
        // fallback to timeout error
      }
      reject(new Error('Quá thời gian chờ phản hồi từ máy chủ (240 giây).'));
    };

    xhr.onerror = () => {
      if (isFinished) return;
      isFinished = true;
      stopPolling();
      reject(new Error('Mất kết nối tới máy chủ trong lúc dựng video.'));
    };

    xhr.onabort = () => {
      if (isFinished) return;
      isFinished = true;
      stopPolling();
      reject(new Error('Yêu cầu dựng video đã bị hủy.'));
    };

    xhr.send(formData);
  });
}
