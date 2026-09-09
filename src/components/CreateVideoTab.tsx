import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Film,
  PackageOpen,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
  Volume2,
} from 'lucide-react';
import type { FootageRecord, ParsedLesson } from '../types';
import { normalizeLessonInput, parseLessonBatch, parseLessonText } from '../lib/parser';
import {
  batchDownloadUrl,
  createBatchId,
  fetchBatchStatus,
  forgetActiveBatch,
  getRememberedBatch,
  isBatchTerminal,
  itemDownloadUrl,
  rememberActiveBatch,
  type ServerBatch,
  uploadRenderBatch,
} from '../lib/batchRenderer';
import { fetchAudioTTS, playAudioBuffer } from '../lib/audio';

interface CreateVideoTabProps {
  footageList: FootageRecord[];
  onGoToFootageTab: () => void;
  onRenderSuccess: () => void;
  onOpenVoiceModal: () => void;
}

const DEFAULT_LESSON_INPUT = `Cấu trúc: I enjoy + V-ing
Giải thích: Dùng để nói về việc mình thích làm.
1. VI: Tôi thích đọc sách.
   EN: I enjoy reading books.
2. VI: Tôi thích đi bộ vào buổi sáng.
   EN: I enjoy walking in the morning.
3. VI: Tôi thích nấu ăn cho gia đình.
   EN: I enjoy cooking for my family.`;

const DRAFT_KEY = 'video-cau-truc-batch-draft-v2';

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) || DEFAULT_LESSON_INPUT;
  } catch {
    return DEFAULT_LESSON_INPUT;
  }
}

function lessonToText(lesson: ParsedLesson): string {
  const lines = [
    `Cấu trúc: ${lesson.structure}`,
    `Giải thích: ${lesson.explanation}`,
  ];
  lesson.pairs.forEach((pair, index) => {
    lines.push(`${index + 1}. VI: ${pair.vi}`);
    lines.push(`   EN: ${pair.en}`);
  });
  return lines.join('\n');
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSeconds(value?: number): string {
  if (!value) return '';
  return `${value.toFixed(1)}s`;
}

function statusText(batch: ServerBatch): string {
  if (batch.status === 'uploading') return 'Máy chủ đang nhận dữ liệu';
  if (batch.status === 'queued') return 'Đã vào hàng đợi máy chủ';
  if (batch.status === 'processing') return 'Máy chủ đang tự dựng lần lượt';
  if (batch.status === 'completed') return 'Đã dựng xong toàn bộ';
  if (batch.status === 'completed_with_errors') return 'Đã chạy hết lô, có bài bị lỗi';
  return 'Lô dựng bị lỗi';
}

export const CreateVideoTab: React.FC<CreateVideoTabProps> = ({
  footageList,
  onGoToFootageTab,
  onRenderSuccess,
  onOpenVoiceModal,
}) => {
  const [rawText, setRawText] = useState(loadDraft);
  const [showDetailedForm, setShowDetailedForm] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(() => getRememberedBatch());
  const [batch, setBatch] = useState<ServerBatch | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [testingVoice, setTestingVoice] = useState<'vi' | 'en' | null>(null);
  const reportedTerminalBatch = useRef<string | null>(null);

  const parsed = useMemo(() => parseLessonBatch(rawText), [rawText]);
  const previewLesson = parsed.lessons[0] || parseLessonText(rawText);
  const activeFootages = footageList.filter((footage) => footage.active);
  const validFootages = activeFootages.filter(
    (footage) => footage.blob && footage.blob.size > 0 && footage.blob.size <= 25 * 1024 * 1024
  );
  const activeBatch = Boolean(batchId);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, rawText);
    } catch {
      // Draft persistence is a convenience only.
    }
  }, [rawText]);

  useEffect(() => {
    if (parsed.detectedCount !== 1) setShowDetailedForm(false);
  }, [parsed.detectedCount]);

  const refreshBatch = useCallback(async () => {
    if (!batchId) return;
    try {
      const latest = await fetchBatchStatus(batchId);
      if (!latest) {
        if (!isUploading) {
          forgetActiveBatch();
          setBatchId(null);
          setBatch(null);
          setScreenError('Không còn tìm thấy lô trước trên máy chủ. Hãy gửi lại nếu lô chưa hoàn tất.');
        }
        return;
      }
      setBatch(latest);
      setScreenError(null);
      if (isBatchTerminal(latest.status) && reportedTerminalBatch.current !== latest.id) {
        reportedTerminalBatch.current = latest.id;
        onRenderSuccess();
      }
    } catch (error: any) {
      setScreenError(error?.message || 'Không cập nhật được tiến độ lô.');
    }
  }, [batchId, isUploading, onRenderSuccess]);

  useEffect(() => {
    if (!batchId) return;
    void refreshBatch();
    const timer = window.setInterval(() => void refreshBatch(), 2500);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshBatch();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [batchId, refreshBatch]);

  const updateSingleLesson = (nextLesson: ParsedLesson) => {
    setRawText(lessonToText(nextLesson));
  };

  const canonicalizeText = (value: string): string => {
    const normalized = normalizeLessonInput(value);
    const result = parseLessonBatch(normalized);
    if (result.errors.length > 0 || result.lessons.length === 0) return normalized;
    return result.lessons.map(lessonToText).join('\n\n');
  };

  const handleNormalizeText = () => {
    const nextText = canonicalizeText(rawText);
    setRawText(nextText);
    const nextResult = parseLessonBatch(nextText);
    setScreenError(nextResult.errors[0] || null);
  };

  const handlePasteText = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text/plain');
    if (!pasted) return;

    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart ?? rawText.length;
    const end = target.selectionEnd ?? start;
    const replaceExample = rawText === DEFAULT_LESSON_INPUT;
    const combined = replaceExample
      ? pasted
      : `${rawText.slice(0, start)}${pasted}${rawText.slice(end)}`;
    setRawText(canonicalizeText(combined));
    setScreenError(null);
  };

  const handleStartBatch = async () => {
    setScreenError(null);
    if (parsed.errors.length > 0 || parsed.lessons.length === 0) {
      setScreenError(parsed.errors[0] || 'Chưa nhận diện được bài học hợp lệ.');
      return;
    }
    if (validFootages.length === 0) {
      setScreenError('Kho chưa có footage hợp lệ nào đang bật. Mỗi clip phải nhỏ hơn hoặc bằng 25 MiB.');
      return;
    }

    const nextBatchId = createBatchId();
    reportedTerminalBatch.current = null;
    rememberActiveBatch(nextBatchId);
    setBatchId(nextBatchId);
    setBatch(null);
    setIsUploading(true);
    setUploadPercent(0);

    try {
      await uploadRenderBatch(nextBatchId, parsed.lessons, validFootages, (progress) => {
        setUploadPercent(progress.percent);
      });
      setUploadPercent(100);
      await refreshBatch();
    } catch (error: any) {
      setScreenError(error?.message || 'Không thể gửi lô lên máy chủ.');
      await refreshBatch();
    } finally {
      setIsUploading(false);
    }
  };

  const handleNewBatch = () => {
    forgetActiveBatch();
    reportedTerminalBatch.current = null;
    setBatchId(null);
    setBatch(null);
    setUploadPercent(0);
    setScreenError(null);
  };

  const handleQuickPlayVoice = async (language: 'vi' | 'en') => {
    setTestingVoice(language);
    try {
      const sample = language === 'vi' ? 'Xin chào, đây là giọng đọc Hoài My' : 'Hello, this is Jenny';
      const audio = await fetchAudioTTS(sample, language);
      await playAudioBuffer(audio.buffer);
    } catch (error: any) {
      setScreenError(`Lỗi phát giọng thử: ${error?.message || 'không xác định'}`);
    } finally {
      setTestingVoice(null);
    }
  };

  const firstCompleted = batch?.items.find((item) => item.downloadReady);
  const currentItem = batch?.items.find(
    (item) => item.status === 'generating_tts' || item.status === 'rendering_video'
  );

  return (
    <div className="grid min-h-0 w-full flex-1 grid-cols-1 gap-5 overflow-y-auto p-3 text-slate-200 sm:p-5 md:gap-8 md:p-8 lg:grid-cols-12">
      <section className="flex min-w-0 flex-col gap-5 lg:col-span-7 md:gap-6">
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              validFootages.length > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
            }`}>
              <Film className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold leading-relaxed text-white">
                Kho footage: {validFootages.length} clip dùng được / {footageList.length} tổng số
              </div>
              <div className="text-[11px] leading-relaxed text-slate-400">
                Mỗi bài chọn ngẫu nhiên 1 clip; clip trùng chỉ phải tải lên máy chủ một lần.
              </div>
            </div>
          </div>
          <button
            onClick={onGoToFootageTab}
            className="flex w-full shrink-0 items-center justify-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-orange-400 transition-colors hover:bg-slate-700 sm:w-auto sm:py-1.5"
          >
            Quản lý footage
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col">
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
                <FileText className="h-4 w-4 text-orange-400" />
                Dán một hoặc nhiều bài
              </label>
              <p className="mt-1 text-[11px] text-slate-500">
                Có thể dán cả đoạn bị dính dòng; app tự tách theo “Cấu trúc:”, số câu và dấu →.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {parsed.detectedCount === 1 && (
                <button
                  type="button"
                  onClick={() => setShowDetailedForm((value) => !value)}
                  className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-orange-300"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {showDetailedForm ? 'Dán văn bản' : 'Sửa chi tiết'}
                </button>
              )}
              <button
                type="button"
                onClick={handleNormalizeText}
                className="flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 text-xs font-semibold text-blue-300"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Chuẩn hóa
              </button>
              <button
                type="button"
                onClick={() => {
                  setRawText('');
                  setShowDetailedForm(false);
                }}
                className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Xóa
              </button>
            </div>
          </div>

          {!showDetailedForm ? (
            <textarea
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              onPaste={handlePasteText}
              rows={16}
              className="min-h-[340px] w-full resize-y rounded-2xl border border-slate-700 bg-slate-900 p-4 font-mono text-sm leading-relaxed text-slate-200 shadow-inner transition-colors focus:border-orange-500 focus:outline-none"
              placeholder={'Cấu trúc: ...\nGiải thích: ...\n1. VI: ...\nEN: ...\n\nCấu trúc: ...\nGiải thích: ...'}
            />
          ) : (
            <div className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-inner">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-400">Cấu trúc:</label>
                <input
                  value={previewLesson.structure}
                  onChange={(event) => updateSingleLesson({ ...previewLesson, structure: event.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:border-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-400">Giải thích:</label>
                <input
                  value={previewLesson.explanation}
                  onChange={(event) => updateSingleLesson({ ...previewLesson, explanation: event.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:border-orange-500 focus:outline-none"
                />
              </div>
              {previewLesson.pairs.map((pair, index) => (
                <div key={index} className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-800/60 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-orange-400">Cặp câu {index + 1}</span>
                  <input
                    value={pair.vi}
                    onChange={(event) => {
                      const pairs = previewLesson.pairs.map((value, pairIndex) =>
                        pairIndex === index ? { ...value, vi: event.target.value } : value
                      );
                      updateSingleLesson({ ...previewLesson, pairs });
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-orange-500 focus:outline-none"
                  />
                  <input
                    value={pair.en}
                    onChange={(event) => {
                      const pairs = previewLesson.pairs.map((value, pairIndex) =>
                        pairIndex === index ? { ...value, en: event.target.value } : value
                      );
                      updateSingleLesson({ ...previewLesson, pairs });
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          )}

          <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
            parsed.errors.length === 0 && parsed.lessons.length > 0
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}>
            {parsed.errors.length === 0 && parsed.lessons.length > 0 ? (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Đã tự chuẩn hóa {parsed.lessons.length} bài, mỗi bài đủ đúng 3 cặp Việt–Anh.</span>
              </div>
            ) : (
              <div className="space-y-1">
                {parsed.errors.slice(0, 5).map((error) => <div key={error}>• {error}</div>)}
                {parsed.errors.length > 5 && <div>• Còn {parsed.errors.length - 5} lỗi khác.</div>}
              </div>
            )}
          </div>
        </div>

        {!activeBatch ? (
          <button
            onClick={handleStartBatch}
            disabled={parsed.errors.length > 0 || parsed.lessons.length === 0 || validFootages.length === 0}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-orange-500 px-6 py-4 font-bold text-white shadow-lg shadow-orange-500/20 transition-all hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-5 w-5 fill-current" />
            <span>Dựng toàn bộ {parsed.lessons.length || 0} video</span>
          </button>
        ) : (
          <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-xs text-blue-200">
            <div className="flex items-center gap-2 font-semibold">
              <RefreshCw className={`h-4 w-4 ${batch && isBatchTerminal(batch.status) ? '' : 'animate-spin'}`} />
              {isUploading ? `Đang tải dữ liệu lên máy chủ: ${uploadPercent}%` : batch ? statusText(batch) : 'Đang kết nối với lô máy chủ'}
            </div>
            {batch && (batch.status === 'queued' || batch.status === 'processing') && (
              <p className="mt-2 leading-relaxed text-emerald-300">
                Lô đã nằm trên máy chủ. Mày có thể chuyển sang app khác; lúc quay lại trang sẽ tự cập nhật tiến độ.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <button
            onClick={() => handleQuickPlayVoice('vi')}
            disabled={testingVoice !== null}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-2 py-2.5 text-[11px] font-medium text-slate-300 hover:bg-slate-800 sm:text-xs"
          >
            <Volume2 className="h-3.5 w-3.5 text-blue-400" />
            {testingVoice === 'vi' ? 'Đang phát...' : 'Nghe thử Hoài My'}
          </button>
          <button
            onClick={() => handleQuickPlayVoice('en')}
            disabled={testingVoice !== null}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-2 py-2.5 text-[11px] font-medium text-slate-300 hover:bg-slate-800 sm:text-xs"
          >
            <Volume2 className="h-3.5 w-3.5 text-purple-400" />
            {testingVoice === 'en' ? 'Đang phát...' : 'Nghe thử Jenny'}
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenVoiceModal}
          className="text-center text-[11px] text-slate-500 underline decoration-slate-700 underline-offset-4"
        >
          Mở bảng nghe thử giọng đầy đủ
        </button>

        {screenError && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-300">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-semibold">Có lỗi:</div>
              <div className="mt-0.5 leading-relaxed">{screenError}</div>
            </div>
          </div>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-5 pb-6 lg:col-span-5 lg:pb-0">
        {batchId ? (
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <PackageOpen className="h-5 w-5 text-orange-400" />
                  Lô video
                </div>
                <div className="mt-1 font-mono text-[10px] text-slate-500">Mã: {batchId.slice(0, 8)}</div>
              </div>
              {batch && isBatchTerminal(batch.status) && (
                <button
                  onClick={handleNewBatch}
                  className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Lô mới
                </button>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-300">
                  {batch ? statusText(batch) : isUploading ? 'Đang tải lô lên' : 'Đang lấy trạng thái'}
                </span>
                <span className="font-mono text-orange-300">
                  {batch ? batch.overallProgress : uploadPercent}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-300 transition-all duration-500"
                  style={{ width: `${batch ? batch.overallProgress : uploadPercent}%` }}
                />
              </div>
              {batch && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                  <span>{batch.completed}/{batch.total} thành công</span>
                  {batch.failed > 0 && <span className="text-red-300">{batch.failed} bị lỗi</span>}
                </div>
              )}
            </div>

            {currentItem && (
              <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3 text-xs">
                <div className="flex items-center gap-2 font-semibold text-orange-300">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Bài {currentItem.index}: {currentItem.stage}
                </div>
                <div className="mt-1 truncate text-slate-400">{currentItem.structure}</div>
                {currentItem.totalDuration > 0 && (
                  <div className="mt-1 font-mono text-[10px] text-slate-500">
                    {currentItem.progress}% · {formatSeconds(currentItem.currentTimeSec)} / {formatSeconds(currentItem.totalDuration)}
                  </div>
                )}
              </div>
            )}

            {batch?.error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                {batch.error}
              </div>
            )}

            {batch && batch.items.length > 0 && (
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {batch.items.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-slate-200">
                          {item.index}. {item.structure}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
                          {item.status === 'completed' ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                          ) : item.status === 'error' ? (
                            <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                          ) : item.status === 'queued' ? (
                            <Clock3 className="h-3.5 w-3.5" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin text-orange-400" />
                          )}
                          <span>{item.stage}</span>
                          {item.outputSize ? <span>· {formatBytes(item.outputSize)}</span> : null}
                        </div>
                        {item.error && <div className="mt-1 text-[10px] leading-relaxed text-red-300">{item.error}</div>}
                      </div>
                      {item.downloadReady && (
                        <a
                          href={itemDownloadUrl(batch.id, item.id)}
                          download
                          className="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-500"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Tải
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {batch?.canDownloadAll && (
              <a
                href={batchDownloadUrl(batch.id)}
                download
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500"
              >
                <Download className="h-4 w-4" />
                Tải tất cả video (.zip)
              </a>
            )}
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-4">
            <div className="relative flex aspect-[9/16] w-full max-w-[290px] select-none flex-col justify-between overflow-hidden rounded-3xl border-4 border-slate-800 bg-slate-950 p-4 shadow-2xl">
              <div className="mt-8 flex w-full flex-col items-center rounded-2xl border border-orange-400 bg-[#EA580C] px-2 py-3 text-center shadow-lg">
                <div className="text-sm font-bold leading-tight text-white">{previewLesson.structure}</div>
                {previewLesson.explanation && (
                  <div className="mt-1 text-[10px] font-medium leading-tight text-white/95">{previewLesson.explanation}</div>
                )}
              </div>
              <div className="w-full rounded-2xl border border-white/10 bg-black/90 p-4 text-center shadow-2xl">
                <div className="text-xs font-bold leading-snug text-white">{previewLesson.pairs[0]?.vi}</div>
                <div className="my-3 h-px w-full bg-white/20" />
                <div className="text-[11px] font-semibold leading-snug text-[#B7B8BA]">{previewLesson.pairs[0]?.en}</div>
              </div>
              <div className="mb-6 text-center text-[13px] font-bold leading-[1.15] text-yellow-400">
                Vào nhóm trong bình luận để<br />
                luyện nghe - nói cùng Hà
              </div>
            </div>
            <div className="max-w-xs text-center text-xs leading-relaxed text-slate-400">
              Khung đang xem trước bài đầu tiên. Khi gửi lô, máy chủ tự dựng lần lượt toàn bộ các bài đã nhận diện.
            </div>
          </div>
        )}

        {firstCompleted && batch && (
          <div className="flex w-full flex-col items-center gap-3">
            <div className="text-xs font-semibold text-slate-300">Xem thử video đã hoàn tất đầu tiên</div>
            <div className="relative aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-2xl border-2 border-emerald-500/50 bg-black">
              <video
                src={itemDownloadUrl(batch.id, firstCompleted.id, true)}
                controls
                preload="metadata"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
