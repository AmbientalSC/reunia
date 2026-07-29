import { BrowserWindow, screen } from 'electron';
import path from 'path';

let floatWindow: BrowserWindow | null = null;

export function getFloatWindow(): BrowserWindow | null {
  return floatWindow;
}

export function createFloatWindow(): BrowserWindow {
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.show();
    floatWindow.focus();
    return floatWindow;
  }

  // Position at bottom-right corner of primary display
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const windowWidth = 340;
  const windowHeight = 64;
  const x = workArea.x + workArea.width - windowWidth - 24;
  const y = workArea.y + workArea.height - windowHeight - 24;

  floatWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    resizable: false,
    focusable: true,
    acceptFirstMouse: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../../preload/index.js'),
      backgroundThrottling: false,
    },
  });

  floatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Load the float widget view
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    floatWindow.loadURL('http://localhost:5173?view=float');
  } else {
    floatWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), {
      query: { view: 'float' },
    });
  }

  floatWindow.on('closed', () => {
    floatWindow = null;
  });

  return floatWindow;
}
