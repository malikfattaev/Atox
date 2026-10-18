import { useEffect, useId, useState, type CSSProperties, type MouseEvent } from 'react'
import { Folder, FolderOpen, Plus } from 'lucide-react'
import { topLevelChats, workerChats } from '../../../shared/chats'
import type { Project } from '../../../shared/models'
import { IS_MAC } from '../../../shared/platform'
import { findProjectColor } from '../../../shared/projectColors'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useAgentPicker } from '../hooks/useAgentPicker'
import { colorSubmenu, parseColorAction } from '../lib/colorMenu'
import { ChatItem } from './ChatItem'
import { InlineRename } from './InlineRename'
import { SortableList, useSortableItem } from './SortableList'

const { atox } = window

/** Папка открывается в файловом менеджере системы: на macOS это Finder. */
const REVEAL_LABEL = IS_MAC ? 'Open in Finder' : 'Open in File Manager'

/** Пункт «Move to Space»: `space:<id>`. */
const SPACE_ACTION_PREFIX = 'space:'

interface ProjectItemProps {
  project: Project
  /** Текущая ветка git в папке проекта; `null` — папка не репозиторий. */
  branch: string | null
}

export function ProjectItem({ project, branch }: ProjectItemProps) {
  const {
    activeChatId,
    createChat,
    renameProject,
    setProjectColor,
    spaces,
    moveProjectToSpace,
    revealProject,
    removeProject,
    moveChat
  } = useProjectsContext()
  // При запуске все проекты свёрнуты: список остаётся коротким, а состояние не запоминается.
  const [expanded, setExpanded] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // Проект тянут за его строку, а переносится он вместе со своими чатами.
  const { itemProps, handleProps } = useSortableItem(project.id, renaming)
  const FolderIcon = expanded ? FolderOpen : Folder
  const chatsId = useId()

  const pickAgentAndCreateChat = useAgentPicker()

  // Чат, открытый с клавиатуры или из уведомления, должен быть виден в сайдбаре.
  const containsActiveChat = project.chats.some(({ id }) => id === activeChatId)
  useEffect(() => {
    if (containsActiveChat) {
      setExpanded(true)
    }
  }, [containsActiveChat, activeChatId])

  // Из контекстного меню чат создаётся сразу с агентом по умолчанию: второе меню подряд неудобно.
  const createProjectChat = () => {
    setExpanded(true)
    void createChat(project.id)
  }

  const pickAgentForProjectChat = () => {
    setExpanded(true)
    void pickAgentAndCreateChat(project.id)
  }

  const otherSpaces = spaces.filter(({ id }) => id !== project.spaceId)

  const openContextMenu = async (event: MouseEvent) => {
    event.preventDefault()
    const action = await atox.showContextMenu([
      { action: 'create-chat', label: 'New chat', symbol: 'square.and.pencil' },
      { type: 'separator' },
      { action: 'rename', label: 'Rename', symbol: 'pencil' },
      colorSubmenu(project.color),
      ...(otherSpaces.length > 0
        ? [
            {
              type: 'submenu' as const,
              label: 'Move to Space',
              symbol: 'rectangle.stack',
              items: otherSpaces.map((space) => ({
                action: `${SPACE_ACTION_PREFIX}${space.id}`,
                label: space.name
              }))
            }
          ]
        : []),
      { action: 'reveal', label: REVEAL_LABEL, symbol: 'folder' },
      { action: 'copy-path', label: 'Copy path', symbol: 'doc.on.doc' },
      { type: 'separator' },
      { action: 'remove', label: 'Remove from list', symbol: 'folder.badge.minus' }
    ])
    const color = parseColorAction(action)
    if (color !== undefined) {
      void setProjectColor(project.id, color)
      return
    }
    if (action?.startsWith(SPACE_ACTION_PREFIX)) {
      void moveProjectToSpace(project.id, action.slice(SPACE_ACTION_PREFIX.length))
      return
    }
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

  const color = findProjectColor(project.color)
  // Цвет задаётся сразу для обеих тем, а нужный выбирает CSS по текущей теме.
  const colorStyle = color
    ? ({ '--project-color': `light-dark(${color.light}, ${color.dark})` } as CSSProperties)
    : undefined

  return (
    <li {...itemProps}>
      <div
        className="row row--project"
        data-colored={Boolean(color)}
        style={colorStyle}
        title={project.path}
        onContextMenu={openContextMenu}
        {...handleProps}
      >
        {renaming ? (
          <div className="row__main">
            <FolderIcon className="icon project-icon" />
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
            <FolderIcon className="icon project-icon" />
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
              items={topLevelChats(project.chats)}
              onMove={(id, toIndex) => void moveChat(id, toIndex)}
            >
              {(chat) => (
                <ChatItem
                  key={chat.id}
                  chat={chat}
                  workers={workerChats(project.chats, chat.id)}
                  projectId={project.id}
                  branch={branch}
                />
              )}
            </SortableList>
          )}
        </div>
      </div>
    </li>
  )
}
