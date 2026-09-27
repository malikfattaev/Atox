import { createContext, useContext, type ReactNode } from 'react'
import { useProjects, type ProjectsState } from './useProjects'

const ProjectsContext = createContext<ProjectsState | null>(null)

export function ProjectsProvider({ children }: { children: ReactNode }) {
  return <ProjectsContext.Provider value={useProjects()}>{children}</ProjectsContext.Provider>
}

export function useProjectsContext(): ProjectsState {
  const state = useContext(ProjectsContext)
  if (!state) {
    throw new Error('useProjectsContext must be used within ProjectsProvider')
  }
  return state
}
