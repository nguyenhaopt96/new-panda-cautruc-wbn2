import React, { useState, useEffect } from 'react';
import { 
  Video, 
  Film, 
  History, 
  Sparkles, 
  Volume2, 
  CheckCircle2, 
  Layers
} from 'lucide-react';
import { FootageRecord } from './types';
import { getAllFootage } from './lib/db';
import { CreateVideoTab } from './components/CreateVideoTab';
import { FootageTab } from './components/FootageTab';
import { HistoryTab } from './components/HistoryTab';
import { VoicePreviewModal } from './components/VoicePreviewModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<'create' | 'footage' | 'history'>('create');
  const [footageList, setFootageList] = useState<FootageRecord[]>([]);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);

  const refreshFootage = async () => {
    try {
      const all = await getAllFootage();
      setFootageList(all);
    } catch (e) {
      console.error('Error fetching footage:', e);
    }
  };

  useEffect(() => {
    refreshFootage();
  }, []);

  const activeCount = footageList.filter((f) => f.active).length;

  const activeScreenLabel =
    activeTab === 'create'
      ? 'Dựng video'
      : activeTab === 'footage'
        ? 'Quản lý footage'
        : 'Lịch sử video';

  return (
    <div
      id="app-container"
      className="flex h-[100dvh] min-h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-[#0F172A] font-sans text-slate-200 md:flex-row"
    >
      {/* Sidebar */}
      <aside
        id="sidebar-nav"
        className="flex w-full shrink-0 flex-col border-b border-slate-800 bg-[#1E293B] md:h-full md:w-64 md:border-r md:border-b-0"
      >
        <div className="w-full p-3 sm:p-4 md:p-6">
          <div className="mb-3 flex items-center justify-between gap-3 md:mb-8">
            <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500 shadow-lg shadow-orange-500/20 md:h-10 md:w-10">
                <Video className="h-5 w-5 text-white md:h-6 md:w-6" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-bold leading-tight text-white md:text-lg">Video Cấu Trúc</h1>
                <span className="text-xs font-semibold text-orange-400 md:text-sm">Anh – Việt</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsVoiceModalOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-orange-400 md:hidden"
              aria-label="Nghe thử giọng TTS"
              title="Nghe thử giọng TTS"
            >
              <Volume2 className="h-5 w-5" />
            </button>
          </div>

          <nav className="grid grid-cols-3 gap-2 md:block md:space-y-2">
            <button
              id="tab-create-btn"
              type="button"
              onClick={() => setActiveTab('create')}
              className={`flex min-w-0 w-full flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-all cursor-pointer sm:text-xs md:flex-row md:justify-start md:gap-3 md:px-4 md:py-3 md:text-base ${
                activeTab === 'create'
                  ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Sparkles className="h-5 w-5 shrink-0" />
              <span className="whitespace-nowrap">Tạo video</span>
            </button>

            <button
              id="tab-footage-btn"
              type="button"
              onClick={() => setActiveTab('footage')}
              className={`relative flex min-w-0 w-full flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-all cursor-pointer sm:text-xs md:flex-row md:justify-between md:px-4 md:py-3 md:text-base ${
                activeTab === 'footage'
                  ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <div className="flex flex-col items-center gap-1 md:flex-row md:gap-3">
                <Film className="h-5 w-5 shrink-0" />
                <span className="whitespace-nowrap">Kho footage</span>
              </div>
              <span className="hidden rounded-full bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300 md:inline-flex">
                {footageList.length}
              </span>
            </button>

            <button
              id="tab-history-btn"
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex min-w-0 w-full flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-all cursor-pointer sm:text-xs md:flex-row md:justify-start md:gap-3 md:px-4 md:py-3 md:text-base ${
                activeTab === 'history'
                  ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <History className="h-5 w-5 shrink-0" />
              <span className="whitespace-nowrap">Lịch sử</span>
            </button>
          </nav>
        </div>

        {/* Engine status widget */}
        <div className="mt-auto hidden border-t border-slate-800/80 p-6 md:block">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400 uppercase tracking-wider font-semibold">
              <span>Động cơ hoạt động</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Footage khả dụng:</span>
              <span className="text-orange-400 font-mono font-medium">{activeCount} clip bật</span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Renderer:</span>
              <span className="text-emerald-400 font-medium">FFmpeg máy chủ</span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Voice Server:</span>
              <span className="text-emerald-400 font-medium">Edge TTS (Real)</span>
            </div>

            <button
              onClick={() => setIsVoiceModalOpen(true)}
              className="w-full mt-2 py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-orange-400 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-slate-700"
            >
              <Volume2 className="w-3.5 h-3.5" />
              Nghe thử giọng TTS
            </button>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <main id="main-content" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Compact mobile status bar */}
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-slate-800 bg-[#0F172A]/95 px-4 md:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-300">
              {activeScreenLabel}
            </span>
          </div>
          <span className="shrink-0 rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300">
            720×1280
          </span>
        </header>

        {/* Desktop header */}
        <header className="hidden h-16 shrink-0 items-center justify-between border-b border-slate-800 bg-[#0F172A]/90 px-8 backdrop-blur-md md:flex">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full" />
            <span className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              {activeTab === 'create' && 'Màn hình: Dựng video cấu trúc'}
              {activeTab === 'footage' && 'Màn hình: Quản lý Footage (IndexedDB)'}
              {activeTab === 'history' && 'Màn hình: Lịch sử video MP4'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 bg-slate-800 text-slate-300 text-xs font-mono rounded-lg border border-slate-700">
              720×1280 • 30fps
            </span>
            <div className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-medium rounded-lg border border-emerald-500/30 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              100% Client + Node Fullstack
            </div>
          </div>
        </header>

        {/* Dynamic Tab Content */}
        {activeTab === 'create' && (
          <CreateVideoTab
            footageList={footageList}
            onGoToFootageTab={() => setActiveTab('footage')}
            onRenderSuccess={refreshFootage}
            onOpenVoiceModal={() => setIsVoiceModalOpen(true)}
          />
        )}

        {activeTab === 'footage' && (
          <FootageTab onFootageUpdated={refreshFootage} />
        )}

        {activeTab === 'history' && <HistoryTab />}

        {/* Footer info bar */}
        <footer className="hidden h-11 shrink-0 items-center justify-between border-t border-slate-800 bg-slate-900 px-8 text-xs text-slate-400 md:flex">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full" />
              TTS: vi-VN-HoaiMyNeural (+0%)
            </span>
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 bg-purple-500 rounded-full" />
              TTS: en-US-JennyNeural (-20%)
            </span>
            <span className="flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5 text-slate-400" />
              Tick WAV: 2.11s (48kHz mono)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span>Database: IndexedDB (video-cau-truc-anh-viet)</span>
          </div>
        </footer>
      </main>

      {/* Real Voice Preview Modal */}
      <VoicePreviewModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
      />
    </div>
  );
}
