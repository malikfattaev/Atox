import { CircleArrowDown, Settings } from 'lucide-react'
import { useReadyUpdate } from '../hooks/useReadyUpdate'
import { useUserProfile } from '../hooks/useUserProfile'

interface ProfileBarProps {
  onOpenSettings(): void
}

export function ProfileBar({ onOpenSettings }: ProfileBarProps) {
  const profile = useUserProfile()
  const initial = profile?.name.charAt(0).toUpperCase()
  const updateVersion = useReadyUpdate()

  return (
    <footer className="profile-bar">
      <div className="profile-bar__user">
        <span className="profile-bar__avatar" aria-hidden>
          {initial}
        </span>
        <span className="profile-bar__name">{profile?.name}</span>
      </div>
      <div className="profile-bar__actions">
        {updateVersion && (
          <button
            type="button"
            className="icon-button update-button"
            aria-label={`Restart to update to Atox ${updateVersion}`}
            title={`Restart to update to Atox ${updateVersion}`}
            onClick={() => window.atox.updates.install()}
          >
            <CircleArrowDown className="icon" />
          </button>
        )}
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
