import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import path from 'path';
import { getAudioService } from './index';
import { createFloatWindow, getFloatWindow } from './windows/floatWindow';
import { createSettingsWindow } from './windows/settingsWindow';

let tray: Tray | null = null;

// Meeting state enum
export type MeetingState = 'idle' | 'recording' | 'paused';

let meetingState: MeetingState = 'idle';
let meetingStateChangeCallback: ((state: MeetingState) => void) | null = null;

export function getMeetingState(): MeetingState {
  return meetingState;
}

export function setMeetingState(state: MeetingState): void {
  meetingState = state;
  updateTrayMenu();
  if (meetingStateChangeCallback) {
    meetingStateChangeCallback(state);
  }
}

export function onMeetingStateChange(callback: (state: MeetingState) => void): void {
  meetingStateChangeCallback = callback;
}

function createTrayIcon(state: 'idle' | 'recording' | 'paused' = 'idle'): Electron.NativeImage {
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  try {
    const img = nativeImage.createFromPath(iconPath);
    return img.resize({ width: 32, height: 32 });
  } catch {
    return generateIcon(state);
  }
}

function generateIcon(state: 'idle' | 'recording' | 'paused'): Electron.NativeImage {
  const size = 32;
  const buffer = Buffer.alloc(size * size * 4);

  const colors = {
    idle:    { r: 100, g: 100, b: 120 }, // gray
    recording: { r: 34, g: 197, b: 94 }, // green
    paused:  { r: 234, g: 179, b: 8 },   // yellow
  };

  const c = colors[state];
  const cx = size / 2, cy = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 14) {
        // Rounded square background (pill shape)
        const corner = 4;
        const inRect = x > corner && x < size - corner && y > corner && y < size - corner;
        const inCorners =
          (dx < 0 && dy < 0 && dist < corner + 1) ||
          (dx > 0 && dy < 0 && Math.sqrt((x - (size - corner)) ** 2 + (y - corner) ** 2) < corner + 1) ||
          (dx < 0 && dy > 0 && Math.sqrt((x - corner) ** 2 + (y - (size - corner)) ** 2) < corner + 1) ||
          (dx > 0 && dy > 0 && Math.sqrt((x - (size - corner)) ** 2 + (y - (size - corner)) ** 2) < corner + 1);

        if (inRect || inCorners) {
          buffer[i] = c.r;
          buffer[i + 1] = c.g;
          buffer[i + 2] = c.b;
          buffer[i + 3] = 255;
        }

        // Draw a simple "R" letter in white in the center
        if (dist < 8) {
          const letterSize = 10;
          const lx = x - cx + letterSize / 2;
          const ly = y - cy + letterSize / 2;

          // Very simplified "R" — vertical line + half circle + leg
          const isVerticalBar = lx >= 2 && lx <= 4 && ly >= 1 && ly <= 9;
          const isTopHalfCircle = dist < 5 && ly >= 1 && ly <= 5 && lx >= 3;
          const isLeg = lx >= 4 && lx <= 7 && ly >= 6 && ly <= 8 && lx - ly <= 2;

          if (isVerticalBar || isTopHalfCircle || isLeg) {
            buffer[i] = 255;
            buffer[i + 1] = 255;
            buffer[i + 2] = 255;
            buffer[i + 3] = 255;
          }
        }
      } else {
        buffer[i + 3] = 0; // Transparent outside the icon
      }
    }
  }

  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function buildMenu(): Electron.Menu {
  const statusLabels: Record<MeetingState, string> = {
    idle: '● Parado',
    recording: '● Gravando...',
    paused: '⏸ Pausado',
  };

  const statusIcon: Record<MeetingState, string> = {
    idle: '⏹',
    recording: '🔴',
    paused: '⏸',
  };

  return Menu.buildFromTemplate([
    {
      label: `Reunia — ${statusLabels[meetingState]}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '▶ Iniciar Reunião',
      visible: meetingState === 'idle',
      click: async () => {
        try {
          await getAudioService().start();
          setMeetingState('recording');
        } catch (err) {
          console.error('[Reunia] Failed to start recording:', err);
        }
      },
    },
    {
      label: '⏸ Pausar',
      visible: meetingState === 'recording',
      click: async () => {
        await getAudioService().pause();
        setMeetingState('paused');
      },
    },
    {
      label: '▶ Retomar',
      visible: meetingState === 'paused',
      click: async () => {
        await getAudioService().resume();
        setMeetingState('recording');
      },
    },
    {
      label: '⏹ Parar Reunião',
      visible: meetingState !== 'idle',
      click: async () => {
        await getAudioService().stop();
        setMeetingState('idle');
      },
    },
    { type: 'separator' },
    {
      label: '⚙ Configurações',
      click: () => {
        createSettingsWindow();
      },
    },
    { type: 'separator' },
    {
      label: '🗕 Mostrar Widget',
      click: () => {
        const floatWin = getFloatWindow();
        if (floatWin) {
          floatWin.show();
          floatWin.focus();
        } else {
          createFloatWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        app.quit();
      },
    },
  ]);
}

function updateTrayMenu(): void {
  if (tray) {
    tray.setContextMenu(buildMenu());
  }
}

export function initTray(): void {
  const icon = createTrayIcon(meetingState);
  tray = new Tray(icon);
  tray.setToolTip('Reunia — Assistente de Reuniões');
  tray.setContextMenu(buildMenu());

  // Click tray icon to show float window
  tray.on('click', () => {
    const floatWin = getFloatWindow();
    if (floatWin) {
      if (floatWin.isVisible()) {
        floatWin.hide();
      } else {
        floatWin.show();
        floatWin.focus();
      }
    } else {
      createFloatWindow();
    }
  });

  // Sync state changes to tray menu + icon
  onMeetingStateChange(() => {
    updateTrayMenu();

    // Update tray icon color based on state
    const newIcon = createTrayIcon(meetingState);
    tray?.setImage(newIcon);

    tray?.setToolTip(
      `Reunia — ${meetingState === 'recording' ? 'Gravando...' : meetingState === 'paused' ? 'Pausado' : 'Parado'}`
    );
  });
}
