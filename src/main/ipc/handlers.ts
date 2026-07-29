import { BrowserWindow, ipcMain, dialog, screen } from 'electron';
import { getConfigStore } from '../store/configStore';
import { getAudioService } from '../index';
import { getInsightService } from '../index';
import { setMeetingState, getMeetingState } from '../tray';
import { getFloatWindow } from '../windows/floatWindow';
import { getMainWindow } from '../windows/mainWindow';

export function registerIpcHandlers(): void {
  const store = getConfigStore();

  // --- Config handlers ---
  ipcMain.handle('config:get', (_event, key: string) => {
    return store.get(key as any);
  });

  ipcMain.handle('config:set', (_event, key: string, value: any) => {
    store.set(key as any, value);
    return true;
  });

  ipcMain.handle('config:getAll', () => {
    return store.all;
  });

  // --- Meeting control ---
  ipcMain.handle('meeting:start', async () => {
    try {
      // Garante que a main window (oculta) fique visível.
      // Em alguns Electron/Chromium, getUserMedia NÃO funciona
      // se a janela estiver com show: false.
      const mainWin = getMainWindow();
      if (mainWin && !mainWin.isDestroyed() && !mainWin.isVisible()) {
        mainWin.show();
        // Como é 1x1px e transparente, é invisível para o usuário
        // mas o Chromium entende que a janela está "visível".
      }

      const audioService = getAudioService();
      await audioService.start();
      setMeetingState('recording');
      return { success: true, state: 'recording' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('meeting:pause', async () => {
    try {
      const audioService = getAudioService();
      await audioService.pause();
      setMeetingState('paused');
      return { success: true, state: 'paused' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('meeting:resume', async () => {
    try {
      const audioService = getAudioService();
      await audioService.resume();
      setMeetingState('recording');
      return { success: true, state: 'recording' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('meeting:stop', async () => {
    try {
      const audioService = getAudioService();
      const meetingData = await audioService.stop();
      setMeetingState('idle');
      return {
        success: true,
        state: 'idle',
        notePath: meetingData?.notePath,
        noteError: meetingData?.noteError,
        meetingData,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('meeting:getState', () => {
    return getMeetingState();
  });

  // --- Audio chunk relay (from renderer to main) ---
  ipcMain.on('audio:mic-chunk', (_event, data: string) => {
    const audioService = getAudioService();
    audioService.onMicChunk(data);
  });

  ipcMain.on('audio:system-chunk', (_event, data: string) => {
    const audioService = getAudioService();
    audioService.onSystemChunk(data);
  });

  // --- Window controls ---
  ipcMain.handle('window:minimizeFloat', () => {
    const win = getFloatWindow();
    if (win) win.minimize();
  });

  ipcMain.handle('window:hideFloat', () => {
    const win = getFloatWindow();
    if (win) win.hide();
  });

  ipcMain.handle('window:showFloat', () => {
    const win = getFloatWindow();
    if (win) win.show();
  });

  // --- Float window resize (for summary expansion) ---
  ipcMain.handle('window:resizeFloat', (_event, width: number, height: number) => {
    const win = getFloatWindow();
    if (win && !win.isDestroyed()) {
      const current = win.getBounds();
      const workArea = screen.getDisplayMatching(current).workArea;
      const nextWidth = Math.min(Math.max(width, 320), workArea.width);
      const nextHeight = Math.min(Math.max(height, 64), workArea.height);
      const right = current.x + current.width;
      const bottom = current.y + current.height;

      // Mantém o float ancorado pelo canto inferior direito ao expandir.
      const x = Math.max(workArea.x, Math.min(right - nextWidth, workArea.x + workArea.width - nextWidth));
      const y = Math.max(workArea.y, Math.min(bottom - nextHeight, workArea.y + workArea.height - nextHeight));

      win.setBounds({ x, y, width: nextWidth, height: nextHeight }, true);
    }
  });

  // --- Native dialogs ---
  ipcMain.handle('dialog:selectFolder', async () => {
    const win = getFloatWindow() || getMainWindow();
    if (!win) return { canceled: true, path: null };

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Selecionar pasta do Obsidian Vault',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }

    return { canceled: false, path: result.filePaths[0] };
  });

  // --- Testing ---
  ipcMain.handle('app:testGroqConnection', async () => {
    try {
      const { getGroqClient, resetGroqClient } = require('../transcription/groqClient');

      // Force reset so the client reads the LATEST key from the store
      resetGroqClient();

      const client = getGroqClient();
      // Simple quick test: list available models
      const models = await client.models.list();
      return { success: true, models: models.data.slice(0, 5) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // --- Check ffmpeg availability for system audio capture ---
  ipcMain.handle('system-audio:checkFfmpeg', async () => {
    try {
      const { execSync } = require('child_process');
      const store = getConfigStore();
      const ffmpegPath = (store as any).get('ffmpegPath') || 'ffmpeg';
      const output = execSync(`"${ffmpegPath}" -version`, { timeout: 5000, windowsHide: true }).toString();
      const versionMatch = output.match(/ffmpeg version ([^ ]+)/);
      return {
        available: true,
        version: versionMatch ? versionMatch[1] : 'desconhecida',
        path: ffmpegPath,
      };
    } catch (err: any) {
      return {
        available: false,
        version: null,
        path: null,
        error: 'ffmpeg não encontrado. Instale com: winget install ffmpeg',
      };
    }
  });

  // --- List audio capture devices via ffmpeg ---
  ipcMain.handle('system-audio:listDevices', async () => {
    try {
      const { execSync } = require('child_process');
      const store = getConfigStore();
      const ffmpegPath = (store as any).get('ffmpegPath') || 'ffmpeg';

      // Testa dshow e wasapi para listar dispositivos
      const devices: string[] = [];

      // Tenta dshow (DirectShow — padrão no Windows)
      try {
        const raw = execSync(`"${ffmpegPath}" -list_devices true -f dshow -i dummy`, {
          timeout: 5000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
        }).toString();
        // Parser: procura por linhas entre [dshow] e o próximo formato
        const dshowMatch = raw.match(/\[dshow @ [^\]]+\] DirectShow audio devices[\s\S]*?(?=\[|\Z)/);
        if (dshowMatch) {
          const names = dshowMatch[0].matchAll(/"([^"]+)"/g);
          for (const m of names) devices.push(m[1]);
        }
      } catch {}

      // Tenta wasapi
      try {
        const raw = execSync(`"${ffmpegPath}" -list_devices true -f wasapi -i dummy`, {
          timeout: 5000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
        }).toString();
        const wasapiMatch = raw.match(/\[wasapi @ [^\]]+\][\s\S]*?(?=\[|\Z)/);
        if (wasapiMatch) {
          const names = wasapiMatch[0].matchAll(/"([^"]+)"/g);
          for (const m of names) {
            if (!devices.includes(m[1])) devices.push(m[1]);
          }
        }
      } catch {}

      return { success: true, devices };
    } catch (err: any) {
      return { success: false, error: err.message, devices: [] };
    }
  });

  // --- Force reset Groq client (called from Settings after saving a new key) ---
  ipcMain.handle('config:resetGroqClient', () => {
    try {
      const { resetGroqClient: reset } = require('../transcription/groqClient');
      reset();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
