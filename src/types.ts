export interface ContentPair {
  vi: string;
  en: string;
}

export interface ParsedLesson {
  structure: string;
  explanation: string;
  pairs: ContentPair[];
}

export interface FootageRecord {
  id: string;
  originalName: string;
  type: string;
  size: number;
  lastModified: number;
  duration: number;
  width: number;
  height: number;
  createdAt: string;
  active: boolean;
  blob: Blob;
}

export interface TimelinePair {
  pairIndex: number;
  vi: string;
  en: string;
  pairStartTime: number;
  viStartTime: number;
  viDuration: number;
  viEndTime: number;
  tickStartTime: number;
  tickDuration: number;
  tickEndTime: number;
  enRevealTime: number;
  enStartTime: number;
  enDuration: number;
  enEndTime: number;
  pairEndTime: number;
}

export interface TimelineManifest {
  totalDuration: number;
  pairs: TimelinePair[];
}

export interface JobRecord {
  id: string;
  createdAt: string;
  structure: string;
  pairs: ContentPair[];
  voiceIds: {
    vi: string;
    en: string;
  };
  footageId: string;
  footageName: string;
  timeline: TimelineManifest;
  duration: number;
  fileSize: number;
  status: 'passed' | 'failed';
  error?: string;
  hasSavedOutput: boolean;
}

export interface OutputRecord {
  id: string;
  jobId: string;
  blob: Blob;
  size: number;
  createdAt: string;
}

export interface AudioItem {
  blob: Blob;
  buffer: ArrayBuffer;
  duration: number;
}

export interface RenderProgress {
  stage: 'idle' | 'preparing' | 'tts' | 'canvas' | 'ffmpeg_init' | 'rendering' | 'done' | 'error';
  percent: number;
  message: string;
}
