/**
 * Сколько ждать ответа на служебный вопрос к агенту: список моделей, команд, плагинов,
 * скиллов, серверов MCP, лимиты и контекст. Обычно агент отвечает за секунды; дольше —
 * он завис, например на сервере MCP, который не отвечает. Срок — с запасом над тем, сколько
 * Atox сам ждёт запуска серверов MCP (`MCP_STARTUP_TIMEOUT_MS`).
 */
export const SERVICE_TIMEOUT_MS = 30_000

/**
 * Результат `work`, но не дольше `ms`: потом — ошибка. Остановить зависшую работу (закрыть
 * процесс агента) должен вызывающий.
 */
export function withTimeout<T>(work: Promise<T>, ms: number = SERVICE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('The agent did not respond in time.')), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}
