import { contextBridge, ipcRenderer } from 'electron';

/**
 * Type-safe API exposed to the renderer process via contextBridge.
 * All communication with the main process happens through these methods.
 */
const electronAPI = {
  // --- Config ---
  getConfig: (key: string) => ipcRenderer.invoke('config:get', key),
  setConfig: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
  getAllConfig: () => ipcRenderer.invoke('config:getAll'),

  // --- Meeting control ---
  startMeeting: () => ipcRenderer.invoke('meeting:start'),
  pauseMeeting: () => ipcRenderer.invoke('meeting:pause'),
  resumeMeeting: () => ipcRenderer.invoke('meeting:resume'),
  stopMeeting: () => ipcRenderer.invoke('meeting:stop'),
  getMeetingState: () => ipcRenderer.invoke('meeting:getState'),

  // --- Audio chunks (renderer -> main) ---
  sendMicChunk: (data: string) => ipcRenderer.send('audio:mic-chunk', data),
  sendSystemChunk: (data: string) => ipcRenderer.send('audio:system-chunk', data),

  // --- Window controls ---
  minimizeFloatWindow: () => ipcRenderer.invoke('window:minimizeFloat'),
  hideFloatWindow: () => ipcRenderer.invoke('window:hideFloat'),
  showFloatWindow: () => ipcRenderer.invoke('window:showFloat'),
  resizeFloatWindow: (width: number, height: number) =>
    ipcRenderer.invoke('window:resizeFloat', width, height),

  // --- Native dialogs ---
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  // --- Testing ---
  testGroqConnection: () => ipcRenderer.invoke('app:testGroqConnection'),
  checkFfmpeg: () => ipcRenderer.invoke('system-audio:checkFfmpeg'),
  listAudioDevices: () => ipcRenderer.invoke('system-audio:listDevices'),
  resetGroqClient: () => ipcRenderer.invoke('config:resetGroqClient'),

  // --- Transcription events (main -> renderer) ---
  onTranscription: (callback: (segment: TranscriptionSegment) => void) => {
    const listener = (_event: any, segment: TranscriptionSegment) => callback(segment);
    ipcRenderer.on('transcription:new-segment', listener);
    return () => ipcRenderer.removeListener('transcription:new-segment', listener);
  },

  // --- Insights events (main -> renderer) ---
  onInsightsUpdate: (callback: (insights: InsightsData) => void) => {
    const listener = (_event: any, insights: InsightsData) => callback(insights);
    ipcRenderer.on('insights:update', listener);
    return () => ipcRenderer.removeListener('insights:update', listener);
  },

  // --- Note saved event (main -> renderer) ---
  onNoteSaved: (callback: (data: {filePath: string; note: any}) => void) => {
    const listener = (_event: any, data: {filePath: string; note: any}) => callback(data);
    ipcRenderer.on('obsidian:note-saved', listener);
    return () => ipcRenderer.removeListener('obsidian:note-saved', listener);
  },

  // --- Meeting state events (main -> renderer) ---
  onMeetingStateChanged: (callback: (state: string) => void) => {
    const listener = (_event: any, state: string) => callback(state);
    ipcRenderer.on('meeting:state-changed', listener);
    return () => ipcRenderer.removeListener('meeting:state-changed', listener);
  },
};

// Type definitions for the exposed API
export interface TranscriptionSegment {
  speaker: 'mic' | 'system' | 'unknown';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface InsightsData {
  actionItems: string[];
  contradictions: string[];
  unresolvedPoints: string[];
  suggestions: string[];
  topics: string[];
  timestamp: number;
}

export type ElectronAPI = typeof electronAPI;

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
