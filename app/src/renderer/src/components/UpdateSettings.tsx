import { useEffect, useState } from 'react'
import type { UpdateCheckResult, UpdateState } from '../../../shared/update'
import { useUpdateState } from '../hooks/useUpdateState'

const { atox } = window

/** Чем закончилась последняя проверка, начатая кнопкой. */
type CheckStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; result: UpdateCheckResult }
  | { kind: 'failed'; message: string }

/** Версия приложения и проверка обновлений по кнопке; готовое обновление ставится отсюда же. */
export function UpdateSettings() {
  const update = useUpdateState()
  const [version, setVersion] = useState<string | null>(null)
  const [status, setStatus] = useState<CheckStatus>({ kind: 'idle' })

  useEffect(() => {
    void atox.updates.currentVersion().then(setVersion)
  }, [])

  const check = async () => {
    setStatus({ kind: 'checking' })
    try {
      setStatus({ kind: 'done', result: await atox.updates.check() })
    } catch (error) {
      setStatus({ kind: 'failed', message: errorMessage(error) })
    }
  }

  return (
    <section className="settings__subgroup" aria-label="Updates">
      <h3 className="settings__subgroup-title">Updates</h3>
      <div className="settings__card">
        <div className="settings__row">
          <span className="settings__label">
            <span>Atox {version}</span>
            <span className="settings__description" aria-live="polite">
              {describe(update, status)}
            </span>
          </span>
          {update?.phase === 'ready' ? (
            <button
              type="button"
              className="settings__button settings__button--primary"
              onClick={() => atox.updates.install()}
            >
              Restart to Update
            </button>
          ) : (
            <button
              type="button"
              className="settings__button"
              disabled={status.kind === 'checking' || update?.phase === 'downloading'}
              onClick={() => void check()}
            >
              Check for Updates
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

/** Подпись под версией: что с обновлением сейчас важнее того, чем закончилась проверка. */
function describe(update: UpdateState, status: CheckStatus): string {
  if (update?.phase === 'downloading') {
    return `Downloading Atox ${update.version}… ${Math.round(update.progress * 100)}%`
  }
  if (update?.phase === 'ready') {
    return `Atox ${update.version} is ready to install.`
  }
  switch (status.kind) {
    case 'checking':
      return 'Checking for updates…'
    case 'failed':
      return `Couldn’t check for updates: ${status.message}`
    case 'done':
      return status.result === 'unsupported'
        ? 'Atox can’t update itself here. Move it to the Applications folder.'
        : 'You’re up to date.'
    case 'idle':
      return 'New versions download automatically.'
  }
}

/** Ошибка из main-процесса приходит с префиксом Electron о вызове IPC — он пользователю не нужен. */
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
