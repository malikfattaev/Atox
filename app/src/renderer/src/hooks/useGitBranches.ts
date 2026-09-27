import { useEffect, useState } from 'react'
import type { GitBranches } from '../../../shared/api'

/** Текущие ветки git в папках проектов; обновляются, как только ветка меняется. */
export function useGitBranches(): GitBranches {
  const [branches, setBranches] = useState<GitBranches>({})

  useEffect(() => {
    const unsubscribe = window.atox.git.subscribe(setBranches)
    void window.atox.git.branches().then(setBranches)
    return unsubscribe
  }, [])

  return branches
}
