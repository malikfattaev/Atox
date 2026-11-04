import { CircleArrowDown, Settings } from 'lucide-react'
import { useUpdateState } from '../hooks/useUpdateState'
import type { UpdateState } from '../../../shared/update'
import { useUserProfile } from '../hooks/useUserProfile'

interface ProfileBarProps {
  onOpenSettings(): void
}

export function ProfileBar({ onOpenSettings }: ProfileBarProps) {
  const profile = useUserProfile()
  const initial = profile?.name.charAt(0).toUpperCase()
  const update = useUpdateState()

  return (
    <footer className="profile-bar">
      <div className="profile-bar__user">
        <span className="profile-bar__avatar" aria-hidden>
          {initial}
        </span>
        <span className="profile-bar__name">{profile?.name}</span>
      </div>
      <div className="profile-bar__actions">
        {update && <UpdateButton update={update} />}
        <button
          type="button"
          className="icon-button"
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
      className="icon-button update-button"
      aria-label={label}
      title={label}
      onClick={() => window.atox.updates.install()}
    >
      <CircleArrowDown className="icon" />
    </button>
  )
}
