import React, { useState, useEffect } from 'react';
import { 
  History, 
  Play, 
  Download, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  FileText 
} from 'lucide-react';
import { JobRecord } from '../types';
import { getAllJobs, deleteJob, getOutput } from '../lib/db';

export const HistoryTab: React.FC = () => {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadJobs = async () => {
    try {
      const allJobs = await getAllJobs();
      setJobs(allJobs);
    } catch (e) {
      console.error('Error loading jobs:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const handlePlayVideo = async (job: JobRecord) => {
    setErrorMsg(null);
    try {
      const output = await getOutput(job.id);
      if (!output || !output.blob) {
        setErrorMsg('Tệp MP4 của video này không còn trong bộ nhớ máy (hoặc đã bị xóa giải phóng dung lượng).');
        return;
      }
      const url = URL.createObjectURL(output.blob);
      setActiveVideoUrl(url);
      setSelectedJob(job);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể mở video');
    }
  };

  const handleDownload = async (job: JobRecord) => {
    try {
      const output = await getOutput(job.id);
      if (!output || !output.blob) {
        alert('Tệp MP4 không còn trong bộ nhớ máy');
        return;
      }
      const url = URL.createObjectURL(output.blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = job.structure.replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `${safeName}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteJob = async (id: string) => {
    await deleteJob(id);
    if (selectedJob?.id === id) {
      closePlayer();
    }
    await loadJobs();
  };

  const closePlayer = () => {
    if (activeVideoUrl) {
      URL.revokeObjectURL(activeVideoUrl);
    }
    setActiveVideoUrl(null);
    setSelectedJob(null);
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 space-y-5 overflow-y-auto p-3 text-slate-200 sm:p-5 md:space-y-6 md:p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <History className="w-5 h-5 text-orange-400" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
            Lịch sử video đã render ({jobs.length})
          </h3>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center gap-3 text-xs text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {!loading && jobs.length === 0 && (
        <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-8 text-center sm:p-12">
          <History className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h4 className="font-semibold text-slate-300 text-sm">Chưa có video nào trong lịch sử</h4>
          <p className="text-xs text-slate-500 mt-1">
            Các video bạn dựng thành công bằng FFmpeg WebAssembly sẽ xuất hiện tại đây.
          </p>
        </div>
      )}

      <div className="space-y-3.5">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700/80 sm:flex-row sm:items-center sm:p-5"
          >
            <div className="flex min-w-0 items-start gap-3 sm:gap-4">
              <div
                onClick={() => handlePlayVideo(job)}
                className="w-12 h-12 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-xl flex items-center justify-center shrink-0 cursor-pointer transition-colors"
              >
                <Play className="w-6 h-6 fill-current" />
              </div>

              <div className="min-w-0">
                <h4 className="break-words text-sm font-bold text-white">{job.structure}</h4>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
                  <span>{new Date(job.createdAt).toLocaleString('vi-VN')}</span>
                  <span>•</span>
                  <span>Footage: {job.footageName}</span>
                  <span>•</span>
                  <span>{job.duration}s</span>
                  <span>•</span>
                  <span>{formatBytes(job.fileSize)}</span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {job.status === 'passed' ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Render thành công 720×1280 30fps
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-400 text-xs">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Lỗi: {job.error || 'Thất bại'}
                    </span>
                  )}

                  {!job.hasSavedOutput && (
                    <span className="text-[11px] text-amber-400/80">
                      (Tệp MP4 đã giải phóng khỏi bộ nhớ)
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:self-center">
              {job.hasSavedOutput && (
                <>
                  <button
                    onClick={() => handlePlayVideo(job)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700 cursor-pointer sm:flex-none sm:px-3.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Phát video
                  </button>

                  <button
                    onClick={() => handleDownload(job)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-orange-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-orange-600 cursor-pointer sm:flex-none sm:px-3.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Tải MP4
                  </button>
                </>
              )}

              <button
                onClick={() => handleDeleteJob(job.id)}
                className="p-2 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                title="Xóa bản ghi này"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Video Player Modal */}
      {activeVideoUrl && selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-2 backdrop-blur-sm sm:p-4">
          <div className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-sm flex-col items-center overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 text-slate-200 shadow-2xl sm:rounded-3xl sm:p-5">
            <button
              onClick={closePlayer}
              className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-bold text-sm text-white mb-3 text-center pr-8 truncate max-w-xs">
              {selectedJob.structure}
            </h3>

            {/* 9:16 Video Player */}
            <div className="mobile-video-frame relative aspect-[9/16] overflow-hidden rounded-2xl border border-slate-700 bg-black shadow-lg">
              <video
                src={activeVideoUrl}
                controls
                autoPlay
                className="w-full h-full object-cover"
              />
            </div>

            <div className="mt-4 grid w-full grid-cols-[1fr_auto] gap-2">
              <button
                onClick={() => handleDownload(selectedJob)}
                className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
              >
                <Download className="w-4 h-4" />
                Tải tệp MP4 về máy
              </button>
              <button
                onClick={closePlayer}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
