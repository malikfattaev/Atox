import { Settings } from 'lucide-react'
import { useUserProfile } from '../hooks/useUserProfile'

interface ProfileBarProps {
  onOpenSettings(): void
}

export function ProfileBar({ onOpenSettings }: ProfileBarProps) {
  const profile = useUserProfile()
  const initial = profile?.name.charAt(0).toUpperCase()

  return (
    <footer className="profile-bar">
      <div className="profile-bar__user">
        <span className="profile-bar__avatar" aria-hidden>
          {initial}
        </span>
        <span className="profile-bar__name">{profile?.name}</span>
      </div>
      <button type="button" className="icon-button" aria-label="Settings" onClick={onOpenSettings}>
        <Settings className="icon" />
      </button>
    </footer>
  )
}
