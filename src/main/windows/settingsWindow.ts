import { BrowserWindow } from 'electron';
import path from 'path';

let settingsWindow: BrowserWindow | null = null;

export function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 520,
    show: false,
    backgroundColor: '#111827',
    frame: true,
    resizable: false,
    title: 'Configurações — Reunia',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,             // Necessário para getDisplayMedia
      preload: path.join(__dirname, '../../preload/index.js'),
      backgroundThrottling: false,
    },
  });

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
    settingsWindow?.focus();
  });

  settingsWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[SettingsWindow] Failed to load ${url}: ${code} ${description}`);
  });

  settingsWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[SettingsWindow] Renderer exited: ${details.reason} (${details.exitCode})`);
  });

  // Load the settings view
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    settingsWindow.loadURL('http://localhost:5173?view=settings');
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), {
      query: { view: 'settings' },
    });
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}
