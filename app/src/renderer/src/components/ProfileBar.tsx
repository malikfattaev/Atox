import { CircleArrowDown, ChartNoAxesColumn, Settings } from 'lucide-react'
import { useUpdateState } from '../hooks/useUpdateState'
import type { UpdateState } from '../../../shared/update'
import { useSettings } from '../hooks/SettingsContext'
import { useUserProfile } from '../hooks/useUserProfile'

interface ProfileBarProps {
  onOpenSettings(): void
  limitsShown: boolean
  onToggleLimits(): void
}

/** Таблетка внизу сайдбара: кто работает, обновление приложения и вход в настройки. */
export function ProfileBar({ onOpenSettings, limitsShown, onToggleLimits }: ProfileBarProps) {
  const profile = useUserProfile()
  const { profileName } = useSettings()
  const name = profileName.trim() || profile?.name
  const initial = name?.charAt(0).toUpperCase()
  const update = useUpdateState()

  return (
    <footer className="profile-card">
      <div className="profile-card__user">
        <span className="profile-card__avatar" aria-hidden>
          {initial}
        </span>
        <span className="profile-card__name">{name}</span>
      </div>
      <div className="profile-card__actions">
        {update && <UpdateButton update={update} />}
        <button
          type="button"
          className="profile-card__action"
          aria-label="Usage"
          aria-pressed={limitsShown}
          title={limitsShown ? 'Hide usage' : 'Show usage'}
          onClick={onToggleLimits}
        >
          <ChartNoAxesColumn className="icon" />
        </button>
        <button
          type="button"
          className="profile-card__action"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <Settings className="icon" />
        </button>
      </div>
    </footer>
  )
}

/** Пока новая версия скачивается — кольцо с прогрессом, когда готова — кнопка перезапуска. */
function UpdateButton({ update }: { update: NonNullable<UpdateState> }) {
  if (update.phase === 'downloading') {
    const percent = Math.round(update.progress * 100)
    const label = `Downloading Atox ${update.version}… ${percent}%`
    return (
      <span className="update-progress" role="progressbar" aria-label={label} title={label}>
        <svg className="update-progress__ring" viewBox="0 0 20 20" aria-hidden>
          <circle className="update-progress__track" cx="10" cy="10" r="8" pathLength={100} />
          <circle
            className="update-progress__value"
            cx="10"
            cy="10"
            r="8"
            pathLength={100}
            strokeDasharray={`${percent} 100`}
          />
        </svg>
      </span>
    )
  }

  const label = `Restart to update to Atox ${update.version}`
  return (
    <button
      type="button"
      className="profile-card__action update-button"
      aria-label={label}
      title={label}
      onClick={() => window.atox.updates.install()}
    >
      <CircleArrowDown className="icon" />
    </button>
  )
}
