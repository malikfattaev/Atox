import { useEffect, useId, useState, type CSSProperties, type MouseEvent } from 'react'
import { Folder, FolderOpen, Plus } from 'lucide-react'
import type { Project } from '../../../shared/models'
import { findProjectColor, isProjectColor, PROJECT_COLORS } from '../../../shared/projectColors'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useAgentPicker } from '../hooks/useAgentPicker'
import { colorSchemeQuery } from '../lib/terminalTheme'
import { ChatItem } from './ChatItem'
import { InlineRename } from './InlineRename'
import { SortableList, useSortableItem } from './SortableList'

const { atox } = window

/** Пункт меню цвета: `color:red`, `color:none` и т. д. */
const COLOR_ACTION_PREFIX = 'color:'
const NO_COLOR = 'none'

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

  const openContextMenu = async (event: MouseEvent) => {
    event.preventDefault()
    const action = await atox.showContextMenu([
      { action: 'create-chat', label: 'New chat', symbol: 'square.and.pencil' },
      { type: 'separator' },
      { action: 'rename', label: 'Rename', symbol: 'pencil' },
      {
        type: 'submenu',
        label: 'Color',
        symbol: 'paintpalette',
        items: [
          { action: `${COLOR_ACTION_PREFIX}${NO_COLOR}`, label: 'None', checked: !project.color },
          { type: 'separator' },
          ...PROJECT_COLORS.map(({ id, name, light, dark }) => ({
            action: `${COLOR_ACTION_PREFIX}${id}` as const,
            label: name,
            swatch: colorSchemeQuery.matches ? dark : light,
            checked: project.color === id
          }))
        ]
      },
      { action: 'reveal', label: 'Open in Finder', symbol: 'folder' },
      { action: 'copy-path', label: 'Copy path', symbol: 'doc.on.doc' },
      { type: 'separator' },
      { action: 'remove', label: 'Remove from list', symbol: 'folder.badge.minus' }
    ])
    if (action?.startsWith(COLOR_ACTION_PREFIX)) {
      const color = action.slice(COLOR_ACTION_PREFIX.length)
      void setProjectColor(project.id, isProjectColor(color) ? color : null)
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
              items={project.chats}
              onMove={(id, toIndex) => void moveChat(id, toIndex)}
            >
              {(chat) => (
                <ChatItem key={chat.id} chat={chat} projectId={project.id} branch={branch} />
              )}
            </SortableList>
          )}
        </div>
      </div>
    </li>
  )
}
