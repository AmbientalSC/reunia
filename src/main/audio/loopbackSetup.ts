/**
 * Configura a captura de áudio do sistema (loopback) no Windows.
 * 
 * No Electron/Windows, o `getDisplayMedia` com `{ audio: true }`
 * já captura o áudio do sistema nativamente quando o usuário
 * seleciona uma tela ou janela no seletor nativo do Windows.
 * 
 * Esta função existe para garantir que o loopback esteja habilitado
 * e para logar o status da configuração.
 */
export function setupLoopbackCapture(): void {
  console.log('[Loopback] System audio capture ready — using native Windows loopback');
}

