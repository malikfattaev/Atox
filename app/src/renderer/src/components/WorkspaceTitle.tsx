interface WorkspaceTitleProps {
  chatTitle: string
  projectName: string
}

/** Название открытого чата и его проекта в шапке рабочей области: «Worker | Atox». */
export function WorkspaceTitle({ chatTitle, projectName }: WorkspaceTitleProps) {
  return (
    <h1 className="workspace-title" title={`${chatTitle} | ${projectName}`}>
      <span className="workspace-title__chat">{chatTitle}</span>
      <span className="workspace-title__separator" aria-hidden="true" />
      <span className="workspace-title__project">{projectName}</span>
    </h1>
  )
}
