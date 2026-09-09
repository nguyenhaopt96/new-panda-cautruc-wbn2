import React, { useState } from 'react';
import { Volume2, Play, RefreshCw, X, CheckCircle2 } from 'lucide-react';
import { fetchAudioTTS, playAudioBuffer } from '../lib/audio';

interface VoicePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VoicePreviewModal: React.FC<VoicePreviewModalProps> = ({ isOpen, onClose }) => {
  const [viText, setViText] = useState('Xin chào, đây là giọng đọc tiếng Việt của Hoài My.');
  const [enText, setEnText] = useState('Hello, this is Jenny speaking with standard American English.');
  const [playingVoice, setPlayingVoice] = useState<'vi' | 'en' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePlayVoice = async (lang: 'vi' | 'en') => {
    setError(null);
    setPlayingVoice(lang);
    try {
      const textToPlay = lang === 'vi' ? viText : enText;
      const audioItem = await fetchAudioTTS(textToPlay, lang);
      await playAudioBuffer(audioItem.buffer);
    } catch (err: any) {
      setError(err?.message || 'Không thể phát âm thanh');
    } finally {
      setPlayingVoice(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-4">
      <div className="relative max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 text-slate-200 shadow-2xl sm:rounded-3xl sm:p-6">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white sm:top-5 sm:right-5"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-5 flex items-center gap-3 pr-10">
          <div className="w-10 h-10 rounded-2xl bg-orange-500/10 text-orange-400 flex items-center justify-center">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold leading-snug text-white sm:text-base">Kiểm tra giọng đọc Microsoft Edge TTS</h3>
            <p className="text-xs text-slate-400">Âm thanh được tạo thật từ Node server</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Vietnamese voice */}
          <div className="bg-slate-800/60 border border-slate-800 rounded-2xl p-4">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="break-words text-xs font-bold text-slate-300">vi-VN-HoaiMyNeural (Tốc độ: +0%)</span>
              </div>
              <span className="text-[11px] px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-md font-mono">Tiếng Việt</span>
            </div>
            <input
              type="text"
              value={viText}
              onChange={(e) => setViText(e.target.value)}
              className="mb-3 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-200 focus:border-orange-500 focus:outline-none sm:text-sm"
            />
            <button
              onClick={() => handlePlayVoice('vi')}
              disabled={playingVoice !== null}
              className="w-full py-2.5 px-4 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {playingVoice === 'vi' ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-orange-400" />
                  Đang phát Hoài My...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current text-blue-400" />
                  Nghe thử giọng Hoài My
                </>
              )}
            </button>
          </div>

          {/* English voice */}
          <div className="bg-slate-800/60 border border-slate-800 rounded-2xl p-4">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-400" />
                <span className="break-words text-xs font-bold text-slate-300">en-US-JennyNeural (Tốc độ: -20%)</span>
              </div>
              <span className="text-[11px] px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-md font-mono">Tiếng Anh</span>
            </div>
            <input
              type="text"
              value={enText}
              onChange={(e) => setEnText(e.target.value)}
              className="mb-3 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-200 focus:border-orange-500 focus:outline-none sm:text-sm"
            />
            <button
              onClick={() => handlePlayVoice('en')}
              disabled={playingVoice !== null}
              className="w-full py-2.5 px-4 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {playingVoice === 'en' ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-orange-400" />
                  Đang phát Jenny...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current text-purple-400" />
                  Nghe thử giọng Jenny
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-slate-800 pt-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Không dùng Web Speech API
          </span>
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 sm:w-auto"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
