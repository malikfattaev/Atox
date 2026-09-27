import { useState, type MouseEvent } from 'react'
import { Folder, FolderOpen, Plus } from 'lucide-react'
import type { Project } from '../../../shared/models'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { ChatItem } from './ChatItem'
import { InlineRename } from './InlineRename'

const { atox } = window

interface ProjectItemProps {
  project: Project
}

export function ProjectItem({ project }: ProjectItemProps) {
  const { createChat, renameProject, revealProject, removeProject } = useProjectsContext()
  const [expanded, setExpanded] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const FolderIcon = expanded ? FolderOpen : Folder

  const createProjectChat = () => {
    setExpanded(true)
    void createChat(project.id)
  }

  const openContextMenu = async (event: MouseEvent) => {
    event.preventDefault()
    const action = await atox.showContextMenu([
      { action: 'create-chat', label: 'Новый чат' },
      { type: 'separator' },
      { action: 'rename', label: 'Переименовать' },
      { action: 'reveal', label: 'Открыть в Finder' },
      { action: 'copy-path', label: 'Скопировать путь' },
      { type: 'separator' },
      { action: 'remove', label: 'Убрать из списка' }
    ])
    switch (action) {
      case 'create-chat':
        createProjectChat()
        break
      case 'rename':
        setRenaming(true)
        break
      case 'reveal':
        void revealProject(project.id)
        break
      case 'copy-path':
        void navigator.clipboard.writeText(project.path)
        break
      case 'remove':
        void removeProject(project.id)
        break
    }
  }

  return (
    <li>
      <div className="row row--project" title={project.path} onContextMenu={openContextMenu}>
        {renaming ? (
          <div className="row__main">
            <FolderIcon className="icon" />
            <InlineRename
              value={project.name}
              label="Название проекта"
              onSubmit={(name) => {
                setRenaming(false)
                void renameProject(project.id, name)
              }}
              onCancel={() => setRenaming(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="row__main"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <FolderIcon className="icon" />
            <span className="row__label">{project.name}</span>
          </button>
        )}
        <button
          type="button"
          className="row__action"
          aria-label="Новый чат"
          onClick={createProjectChat}
        >
          <Plus className="icon" />
        </button>
      </div>

      {expanded && project.chats.length > 0 && (
        <ul>
          {project.chats.map((chat) => (
            <ChatItem key={chat.id} chat={chat} />
          ))}
        </ul>
      )}
    </li>
  )
}
