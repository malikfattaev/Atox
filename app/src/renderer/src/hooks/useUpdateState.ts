import { useEffect, useState } from 'react'

/** Версия обновления, которое скачано и ждёт установки; `null` — обновлений нет. */
export function useReadyUpdate(): string | null {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = window.atox.updates.subscribe(setVersion)
    void window.atox.updates.readyVersion().then(setVersion)
    return unsubscribe
  }, [])

  return version
}
