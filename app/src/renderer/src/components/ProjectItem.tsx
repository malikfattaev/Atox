import { useId, useState, type MouseEvent } from 'react'
import { Folder, FolderOpen, Plus } from 'lucide-react'
import type { Project } from '../../../shared/models'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useAgentPicker } from '../hooks/useAgentPicker'
import { ChatItem } from './ChatItem'
import { InlineRename } from './InlineRename'
import { SortableList, useSortableItem } from './SortableList'

const { atox } = window

interface ProjectItemProps {
  project: Project
  /** Текущая ветка git в папке проекта; `null` — папка не репозиторий. */
  branch: string | null
}

export function ProjectItem({ project, branch }: ProjectItemProps) {
  const { createChat, renameProject, revealProject, removeProject, moveChat } = useProjectsContext()
  const [expanded, setExpanded] = useState(true)
  const [renaming, setRenaming] = useState(false)
  // Проект тянут за его строку, а переносится он вместе со своими чатами.
  const { itemProps, handleProps } = useSortableItem(project.id, renaming)
  const FolderIcon = expanded ? FolderOpen : Folder
  const chatsId = useId()

  const pickAgentAndCreateChat = useAgentPicker()

  // Из контекстного меню чат создаётся сразу с агентом по умолчанию: второе меню подряд неудобно.
  const createProjectChat = () => {
    setExpanded(true)
    void createChat(project.id)
  }

  const pickAgentForProjectChat = () => {
    setExpanded(true)
    void pickAgentAndCreateChat(project.id)
  }

  const openContextMenu = async (event: MouseEvent) => {
    event.preventDefault()
    const action = await atox.showContextMenu([
      { action: 'create-chat', label: 'New chat', symbol: 'square.and.pencil' },
      { type: 'separator' },
      { action: 'rename', label: 'Rename', symbol: 'pencil' },
      { action: 'reveal', label: 'Open in Finder', symbol: 'folder' },
      { action: 'copy-path', label: 'Copy path', symbol: 'doc.on.doc' },
      { type: 'separator' },
      { action: 'remove', label: 'Remove from list', symbol: 'folder.badge.minus' }
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
    <li {...itemProps}>
      <div
        className="row row--project"
        title={project.path}
        onContextMenu={openContextMenu}
        {...handleProps}
      >
        {renaming ? (
          <div className="row__main">
            <FolderIcon className="icon" />
            <InlineRename
              value={project.name}
              label="Project name"
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
            aria-controls={chatsId}
            onClick={() => setExpanded((value) => !value)}
          >
            <FolderIcon className="icon" />
            <span className="row__label">{project.name}</span>
          </button>
        )}
        <button
          type="button"
          className="row__action"
          aria-label="New chat"
          onClick={pickAgentForProjectChat}
        >
          <Plus className="icon" />
        </button>
      </div>

      {/* Свёрнутые чаты остаются в DOM, чтобы список плавно раскрывался и сворачивался. */}
      <div id={chatsId} className="project-chats" data-expanded={expanded} inert={!expanded}>
        <div className="project-chats__content">
          {project.chats.length > 0 && (
            <SortableList
              items={project.chats}
              onMove={(id, toIndex) => void moveChat(id, toIndex)}
            >
              {(chat) => <ChatItem key={chat.id} chat={chat} branch={branch} />}
            </SortableList>
          )}
        </div>
      </div>
    </li>
  )
}
