import { invoke } from '@tauri-apps/api/core'

/**
 * Encaminha erros do frontend para o arquivo de log do app (mesmo arquivo do backend Rust),
 * para que fechamentos/falhas em máquinas de usuários possam ser investigados.
 */

export type LogLevel = 'error' | 'warn' | 'info'

const DUPLICATE_WINDOW_MS = 1_000

let lastMessage = ''
let lastSentAt = 0

export function formatLogArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg
  }
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`
  }
  try {
    return JSON.stringify(arg) ?? String(arg)
  } catch {
    return String(arg)
  }
}

/** Grava uma mensagem no log do app. Nunca lança nem usa console.error (evita recursão). */
export function logToFile(level: LogLevel, message: string): void {
  const now = Date.now()
  // Um loop de erros não pode inundar o disco: ignora repetições idênticas em sequência.
  if (message === lastMessage && now - lastSentAt < DUPLICATE_WINDOW_MS) {
    return
  }
  lastMessage = message
  lastSentAt = now

  try {
    invoke('log_frontend_event', { level, message }).catch(() => {
      // Fora do Tauri (ex.: `next dev` no navegador) o comando não existe — ignora.
    })
  } catch {
    // Idem: o log nunca pode quebrar a aplicação.
  }
}

/** Registra erros não tratados e `console.error` no log. Retorna a função de limpeza. */
export function installGlobalErrorLogging(): () => void {
  const originalConsoleError = console.error

  console.error = (...args: unknown[]) => {
    originalConsoleError(...args)
    logToFile('error', args.map(formatLogArg).join(' '))
  }

  const handleError = (event: ErrorEvent) => {
    const location = `${event.filename}:${event.lineno}:${event.colno}`
    const stack = event.error instanceof Error && event.error.stack ? `\n${event.error.stack}` : ''
    logToFile('error', `Erro não tratado: ${event.message} (${location})${stack}`)
  }

  const handleRejection = (event: PromiseRejectionEvent) => {
    logToFile('error', `Promise rejeitada sem tratamento: ${formatLogArg(event.reason)}`)
  }

  window.addEventListener('error', handleError)
  window.addEventListener('unhandledrejection', handleRejection)

  return () => {
    console.error = originalConsoleError
    window.removeEventListener('error', handleError)
    window.removeEventListener('unhandledrejection', handleRejection)
  }
}
