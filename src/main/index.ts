import { app, BrowserWindow, session } from 'electron';
import path from 'path';
import { initTray } from './tray';
import { createMainWindow, getMainWindow } from './windows/mainWindow';
import { createFloatWindow } from './windows/floatWindow';
import { createSettingsWindow } from './windows/settingsWindow';
import { registerIpcHandlers } from './ipc/handlers';
import { setupLoopbackCapture } from './audio/loopbackSetup';
import { AudioService } from './audio/audioService';
import { InsightService } from './analysis/insightService';

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Flags para habilitar captura de tela/áudio
app.commandLine.appendSwitch('enable-usermedia-screen-capture');
app.commandLine.appendSwitch('enable-features', 'DisplayCapture');

let audioService: AudioService | null = null;
let insightService: InsightService | null = null;

export function getAudioService(): AudioService {
  if (!audioService) {
    audioService = new AudioService();
  }
  return audioService;
}

export function getInsightService(): InsightService {
  if (!insightService) {
    insightService = new InsightService();
  }
  return insightService;
}

// --- App lifecycle ---
app.whenReady().then(async () => {
  console.log('[Reunia] App starting...');

  // Autoriza somente as permissões de mídia usadas pelo aplicativo.
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      console.log(`[Permissions] Request: "${permission}"`);
      callback(permission === 'media' || permission === 'display-capture');
    }
  );

  // Entrega o loopback do dispositivo de saída atual ao getDisplayMedia.
  // No Windows, `audio: "loopback"` captura o som reproduzido pelo sistema
  // sem depender de Stereo Mix, dispositivo virtual ou FFmpeg.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    try {
      if (!request.frame) {
        console.error('[DisplayMedia] Request frame is no longer available.');
        callback({});
        return;
      }

      // getDisplayMedia exige uma faixa de vídeo. Usar a própria frame evita
      // inicializar o duplicador DXGI da tela inteira; o renderer descarta essa
      // faixa imediatamente e mantém apenas o loopback de áudio do Windows.
      callback({
        video: request.frame,
        audio: 'loopback',
      });
    } catch (err) {
      console.error('[DisplayMedia] Failed to provide loopback stream:', err);
      callback({});
    }
  });

  // Setup loopback audio capture
  setupLoopbackCapture();

  // Register all IPC handlers
  registerIpcHandlers();

  // Create tray icon
  initTray();

  // Create hidden main window (runs BackgroundWorker for audio capture)
  createMainWindow();

  // Create floating widget window
  createFloatWindow();

  console.log('[Reunia] App ready.');
});

// macOS: re-create window if dock icon clicked and no windows
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createFloatWindow();
  }
});

// Keep app running in tray (don't quit when all windows are closed)
app.on('window-all-closed', () => {
  // On macOS, apps stay in menu bar. On Windows, we stay in tray.
  if (process.platform !== 'darwin') {
    // Don't quit — app lives in tray
  }
});

// Cleanup before quit
app.on('before-quit', async () => {
  console.log('[Reunia] Quitting...');

  if (audioService) {
    await audioService.stop();
    audioService = null;
  }
});

app.on('will-quit', () => {
  console.log('[Reunia] Goodbye.');
});
