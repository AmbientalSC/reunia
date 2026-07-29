/**
 * AudioDeviceManager — Enumeração e gerenciamento de dispositivos de áudio.
 * 
 * Funções para listar dispositivos de entrada (microfones) e
 * gerenciar a seleção de fontes de áudio do sistema (saída).
 * 
 * Tanto o main process quanto o renderer usam este módulo.
 */

export interface AudioDeviceInfo {
  deviceId: string;
  groupId: string;
  kind: 'audioinput' | 'audiooutput';
  label: string;
}

/**
 * Lista todos os dispositivos de áudio disponíveis no sistema.
 * Precisa ser chamado após o usuário conceder permissão de microfone
 * para que os labels apareçam (senão vêm vazios).
 */
export async function enumerateAudioDevices(requestPermission = false): Promise<{
  inputs: AudioDeviceInfo[];
  outputs: AudioDeviceInfo[];
}> {
  try {
    // A abertura da tela não deve ativar o microfone. A permissão só é
    // solicitada quando o usuário atualiza explicitamente a lista.
    if (requestPermission) {
      await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(stream => stream.getTracks().forEach(t => t.stop()))
        .catch(() => {
          // Permissão negada — ainda tentamos listar, mas labels virão vazios
        });
    }

    const devices = await navigator.mediaDevices.enumerateDevices();

    const inputs: AudioDeviceInfo[] = [];
    const outputs: AudioDeviceInfo[] = [];

    for (const device of devices) {
      if (device.kind === 'audioinput') {
        inputs.push({
          deviceId: device.deviceId,
          groupId: device.groupId,
          kind: 'audioinput',
          label: device.label || `Microfone ${inputs.length + 1}`,
        });
      } else if (device.kind === 'audiooutput') {
        outputs.push({
          deviceId: device.deviceId,
          groupId: device.groupId,
          kind: 'audiooutput',
          label: device.label || `Saída de áudio ${outputs.length + 1}`,
        });
      }
    }

    return { inputs, outputs };
  } catch (err) {
    console.error('[AudioDeviceManager] Failed to enumerate devices:', err);
    return { inputs: [], outputs: [] };
  }
}

/**
 * Obtém constraints de áudio para getUserMedia com base no deviceId selecionado.
 */
export function getAudioConstraints(deviceId?: string): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    sampleRate: 24000,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  if (deviceId && deviceId !== 'default') {
    constraints.deviceId = { exact: deviceId };
  }

  return constraints;
}
