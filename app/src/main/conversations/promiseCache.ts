interface Entry<Value> {
  promise: Promise<Value>
  expiresAt: number
}

/**
 * Ответы по ключу, которые помнятся `ttlMs`: пока ответ не устарел, повторный вопрос получает
 * его же, даже если первый ещё не закончился. Неудачный ответ забывается сразу.
 */
export class PromiseCache<Key, Value> {
  private readonly entries = new Map<Key, Entry<Value>>()

  constructor(private readonly ttlMs: number) {}

  /** Забывает ответ по ключу: следующий вопрос спросит заново. */
  delete(key: Key): void {
    this.entries.delete(key)
  }

  /** Забывает все ответы: следующий вопрос спросит заново. */
  clear(): void {
    this.entries.clear()
  }

  get(key: Key, load: () => Promise<Value>): Promise<Value> {
    const cached = this.entries.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise
    }
    const entry: Entry<Value> = { promise: load(), expiresAt: Date.now() + this.ttlMs }
    this.entries.set(key, entry)
    entry.promise.catch(() => {
      // Ключ мог уже получить новый ответ — его не трогаем.
      if (this.entries.get(key) === entry) {
        this.entries.delete(key)
      }
    })
    return entry.promise
  }
}
