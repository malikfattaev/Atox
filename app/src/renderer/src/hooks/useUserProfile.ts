import { useEffect, useState } from 'react'
import type { UserProfile } from '../../../shared/models'

export function useUserProfile(): UserProfile | null {
  const [profile, setProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    void window.atox.system.getUserProfile().then(setProfile)
  }, [])

  return profile
}
