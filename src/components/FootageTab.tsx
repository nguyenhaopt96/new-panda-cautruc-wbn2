import React, { useState, useRef, useEffect } from 'react';
import { 
  Film, 
  UploadCloud, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Play, 
  X,
  Info
} from 'lucide-react';
import { FootageRecord } from '../types';
import { 
  getAllFootage, 
  saveFootage, 
  deleteFootage, 
  toggleFootageActive, 
  setAllFootageActive, 
  requestStoragePersistence 
} from '../lib/db';

interface FootageTabProps {
  onFootageUpdated: () => void;
}

export const FootageTab: React.FC<FootageTabProps> = ({ onFootageUpdated }) => {
  const [footageList, setFootageList] = useState<FootageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
  const [previewFootage, setPreviewFootage] = useState<FootageRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFootage = async () => {
    try {
      const all = await getAllFootage();
      setFootageList(all);
    } catch (err: any) {
      console.error('Error loading footage:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFootage();
  }, []);

  useEffect(() => {
    if (previewFootage) {
      const url = URL.createObjectURL(previewFootage.blob);
      setPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
        setPreviewUrl(null);
      };
    }
  }, [previewFootage]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    setUploadError(null);

    let uploadedCount = 0;
    const fileArray = Array.from(files);

    try {
      for (const file of fileArray) {
        // Check file type
        const validTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];
        const isExtValid = /\.(mp4|mov|webm|mkv)$/i.test(file.name);
        if (!validTypes.includes(file.type) && !isExtValid) {
          continue;
        }

        // Check if file is larger than 200MB to warn
        if (file.size > 200 * 1024 * 1024) {
          console.warn(`Tệp ${file.name} lớn hơn 200MB, quá trình render WASM có thể cần nhiều RAM.`);
        }

        // Validate real video metadata via HTMLVideoElement
        const videoBlobUrl = URL.createObjectURL(file);
        const videoMeta = await new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
          const vid = document.createElement('video');
          vid.preload = 'metadata';
          vid.onloadedmetadata = () => {
            resolve({
              duration: vid.duration,
              width: vid.videoWidth,
              height: vid.videoHeight,
            });
          };
          vid.onerror = () => {
            reject(new Error(`Không thể đọc metadata của video "${file.name}"`));
          };
          vid.src = videoBlobUrl;
        }).finally(() => {
          URL.revokeObjectURL(videoBlobUrl);
        });

        if (videoMeta.duration <= 0 || videoMeta.width <= 0 || videoMeta.height <= 0) {
          throw new Error(`Video "${file.name}" không có thời lượng hoặc kích thước hợp lệ`);
        }

        const newRecord: FootageRecord = {
          id: crypto.randomUUID(),
          originalName: file.name,
          type: file.type || 'video/mp4',
          size: file.size,
          lastModified: file.lastModified,
          duration: Math.round(videoMeta.duration * 10) / 10,
          width: videoMeta.width,
          height: videoMeta.height,
          createdAt: new Date().toISOString(),
          active: true,
          blob: file,
        };

        await saveFootage(newRecord);
        uploadedCount++;
      }

      if (uploadedCount > 0) {
        // Request persistence on first upload
        const persisted = await requestStoragePersistence();
        if (!persisted) {
          setPersistenceWarning(
            'Trình duyệt chưa cấp quyền lưu trữ vĩnh viễn (Persisted Storage). Dữ liệu có thể bị xóa nếu bộ nhớ máy quá đầy.'
          );
        }
      }

      await loadFootage();
      onFootageUpdated();
    } catch (err: any) {
      setUploadError(err?.message || 'Có lỗi xảy ra khi tải video lên');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleToggleActive = async (id: string, current: boolean) => {
    await toggleFootageActive(id, !current);
    await loadFootage();
    onFootageUpdated();
  };

  const handleSetAll = async (active: boolean) => {
    await setAllFootageActive(active);
    await loadFootage();
    onFootageUpdated();
  };

  const handleDelete = async (id: string) => {
    await deleteFootage(id);
    setDeleteConfirmId(null);
    if (previewFootage?.id === id) {
      setPreviewFootage(null);
    }
    await loadFootage();
    onFootageUpdated();
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 space-y-5 overflow-y-auto p-3 text-slate-200 sm:p-5 md:space-y-6 md:p-8">
      {/* Notice Banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/90 p-3.5 shadow-sm sm:gap-3.5 sm:p-4">
        <Info className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed text-slate-300">
          <span className="font-semibold text-white">Lưu ý lưu trữ: </span>
          Footage được lưu riêng trên trình duyệt này. Nếu xóa dữ liệu website hoặc đổi thiết bị, bạn cần tải footage lên lại.
        </div>
      </div>

      {persistenceWarning && (
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-start gap-3 text-xs text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{persistenceWarning}</span>
        </div>
      )}

      {uploadError && (
        <div className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-start gap-3 text-xs text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Upload Box */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className="group cursor-pointer rounded-3xl border-2 border-dashed border-slate-700 bg-slate-900/50 p-5 text-center transition-all hover:border-orange-500/60 hover:bg-slate-900/80 sm:p-8"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="w-14 h-14 bg-orange-500/10 text-orange-400 group-hover:scale-110 rounded-2xl flex items-center justify-center mx-auto mb-3.5 transition-transform">
          <UploadCloud className="w-7 h-7" />
        </div>
        <h3 className="font-bold text-base text-white">
          {isUploading ? 'Đang đọc và lưu video vào IndexedDB...' : 'Tải video nền lên kho'}
        </h3>
        <p className="text-xs text-slate-400 mt-1.5 max-w-md mx-auto">
          Kéo thả hoặc bấm để chọn video thật (MP4, MOV, WEBM). Mỗi lần dựng video sẽ chọn ngẫu nhiên 1 clip đang được bật (active).
        </p>
      </div>

      {/* Footage List Controls */}
      <div className="flex flex-col justify-between gap-3 pt-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex items-center gap-2.5">
          <Film className="w-5 h-5 text-orange-400" />
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
            Kho Footage ({footageList.length} clips)
          </h3>
        </div>

        {footageList.length > 0 && (
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
            <button
              onClick={() => handleSetAll(true)}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700 cursor-pointer sm:py-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Bật tất cả
            </button>
            <button
              onClick={() => handleSetAll(false)}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700 cursor-pointer sm:py-1.5"
            >
              <XCircle className="w-3.5 h-3.5 text-slate-400" />
              Tắt tất cả
            </button>
          </div>
        )}
      </div>

      {/* Empty State */}
      {!loading && footageList.length === 0 && (
        <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-8 text-center sm:p-12">
          <Film className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h4 className="font-semibold text-slate-300 text-sm">Kho footage đang trống (0 clips)</h4>
          <p className="text-xs text-slate-500 mt-1">
            Vui lòng tải lên video nền của bạn để tiến hành dựng video cấu trúc.
          </p>
        </div>
      )}

      {/* Grid of Footage items */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 xl:grid-cols-3">
        {footageList.map((f) => (
          <div
            key={f.id}
            className={`bg-slate-900 border rounded-2xl p-4 flex flex-col justify-between transition-all ${
              f.active ? 'border-orange-500/80 shadow-md shadow-orange-500/10' : 'border-slate-800 hover:border-slate-700'
            }`}
          >
            <div>
              {/* Thumbnail / Video trigger */}
              <div
                onClick={() => setPreviewFootage(f)}
                className="h-32 bg-black rounded-xl mb-3 flex items-center justify-center relative overflow-hidden cursor-pointer group"
              >
                <div className="w-10 h-10 rounded-full bg-orange-500/80 text-white flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                </div>
                {f.active && (
                  <span className="absolute top-2 right-2 px-2 py-0.5 bg-orange-500 text-white text-[10px] font-bold rounded-md shadow-sm">
                    Đang bật
                  </span>
                )}
                <span className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/80 text-white text-[10px] font-mono rounded">
                  {f.duration}s
                </span>
              </div>

              <div className="font-semibold text-xs text-slate-200 truncate" title={f.originalName}>
                {f.originalName}
              </div>

              <div className="text-[11px] text-slate-400 mt-1 flex justify-between">
                <span>{f.width}×{f.height}</span>
                <span>{formatBytes(f.size)}</span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-300 select-none">
                <input
                  type="checkbox"
                  checked={f.active}
                  onChange={() => handleToggleActive(f.id, f.active)}
                  className="rounded border-slate-700 text-orange-500 focus:ring-0 cursor-pointer"
                />
                <span>{f.active ? 'Hoạt động' : 'Tạm tắt'}</span>
              </label>

              <button
                onClick={() => setDeleteConfirmId(f.id)}
                className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg hover:bg-slate-800 transition-colors"
                title="Xóa clip này"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Video Preview Modal */}
      {previewFootage && previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-4">
          <div className="relative max-h-[calc(100dvh-1rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 text-slate-200 shadow-2xl sm:rounded-3xl sm:p-6">
            <button
              onClick={() => setPreviewFootage(null)}
              className="absolute top-3 right-3 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white sm:top-5 sm:right-5"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-bold text-sm text-white mb-3 truncate pr-10">
              {previewFootage.originalName}
            </h3>

            <div className="w-full bg-black rounded-2xl overflow-hidden aspect-video flex items-center justify-center">
              <video
                src={previewUrl}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            </div>

            <div className="mt-4 flex flex-col gap-1 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span>Độ phân giải: {previewFootage.width}×{previewFootage.height}</span>
              <span>Thời lượng: {previewFootage.duration}s</span>
              <span>Dung lượng: {formatBytes(previewFootage.size)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 text-slate-200 shadow-2xl sm:rounded-3xl sm:p-6">
            <h3 className="font-bold text-base text-white mb-2">Xác nhận xóa footage</h3>
            <p className="text-xs text-slate-400 mb-5">
              Clip này sẽ bị xóa vĩnh viễn khỏi bộ nhớ IndexedDB của trình duyệt. Bạn có chắc chắn muốn xóa?
            </p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end sm:gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Hủy bỏ
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-xl shadow-sm"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
