/**
 * Очередь, которую читают через `for await`: значения приходят по мере `push`, чтение
 * заканчивается после `end`. Через неё агенту по одному передаются сообщения пользователя.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiting: ((result: IteratorResult<T>) => void)[] = []
  private ended = false

  push(value: T): void {
    if (this.ended) {
      return
    }
    const reader = this.waiting.shift()
    if (reader) {
      reader({ value, done: false })
    } else {
      this.values.push(value)
    }
  }

  end(): void {
    this.ended = true
    for (const reader of this.waiting.splice(0)) {
      reader({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift()!, done: false })
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise((resolve) => this.waiting.push(resolve))
      },
      return: () => {
        this.end()
        return Promise.resolve({ value: undefined, done: true })
      }
    }
  }
}
