import { createContext, useContext, type ReactNode } from 'react'
import { useProjects, type ProjectActions, type ProjectsState } from './useProjects'

const ProjectsContext = createContext<ProjectsState | null>(null)
/**
 * Только действия: их ссылки не меняются, поэтому строки сайдбара, которым нужны лишь действия,
 * не перерисовываются при каждом выборе чата.
 */
const ProjectActionsContext = createContext<ProjectActions | null>(null)

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { state, actions } = useProjects()
  return (
    <ProjectActionsContext.Provider value={actions}>
      <ProjectsContext.Provider value={state}>{children}</ProjectsContext.Provider>
    </ProjectActionsContext.Provider>
  )
}

export function useProjectsContext(): ProjectsState {
  const state = useContext(ProjectsContext)
  if (!state) {
    throw new Error('useProjectsContext must be used within ProjectsProvider')
  }
  return state
}

export function useProjectActions(): ProjectActions {
  const actions = useContext(ProjectActionsContext)
  if (!actions) {
    throw new Error('useProjectActions must be used within ProjectsProvider')
  }
  return actions
}
