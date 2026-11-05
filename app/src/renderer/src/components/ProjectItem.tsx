import { useEffect, useId, useState, type CSSProperties, type MouseEvent } from 'react'
import {
  Copy,
  Folder,
  FolderMinus,
  FolderOpen,
  GitPullRequest,
  Layers,
  Pencil,
  Plus,
  Shapes,
  SquarePen
} from 'lucide-react'
import { topLevelChats, workerChats } from '../../../shared/chats'
import type { Project } from '../../../shared/models'
import { IS_MAC } from '../../../shared/platform'
import { findProjectColor } from '../../../shared/projectColors'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { colorSubmenu, parseColorAction } from '../lib/colorMenu'
import { showMenu } from '../lib/menu'
import { projectIconComponent } from '../lib/projectIcons'
import { ChatItem } from './ChatItem'
import { IconPicker } from './IconPicker'
import { InlineRename } from './InlineRename'
import { SortableList, useSortableItem } from './SortableList'

/** Папка открывается в файловом менеджере системы: на macOS это Finder. */
const REVEAL_LABEL = IS_MAC ? 'Open in Finder' : 'Open in File Manager'

/** Пункт «Move to Space»: `space:<id>`. */
const SPACE_ACTION_PREFIX = 'space:'

interface ProjectItemProps {
  project: Project
  /** Текущая ветка git в папке проекта; `null` — папка не репозиторий. */
  branch: string | null
  /** Открывает коммиты, PR и issue проекта. */
  onOpenRepository(projectId: string): void
}

export function ProjectItem({ project, branch, onOpenRepository }: ProjectItemProps) {
  const {
    activeChatId,
    createChat,
    renameProject,
    setProjectColor,
    setProjectIcon,
    spaces,
    moveProjectToSpace,
    revealProject,
    removeProject,
    moveChat
  } = useProjectsContext()
  // При запуске все проекты свёрнуты: список остаётся коротким, а состояние не запоминается.
  const [expanded, setExpanded] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // Строка проекта, под которой открыт выбор значка; `null` — выбор закрыт.
  const [iconPickerAnchor, setIconPickerAnchor] = useState<Element | null>(null)
  // Проект тянут за его строку, а переносится он вместе со своими чатами.
  const { itemProps, handleProps } = useSortableItem(project.id, renaming)
  // Свой значок проекта заменяет папку; без него папка открыта, когда видны чаты.
  const CustomIcon = projectIconComponent(project.icon)
  const ProjectGlyph = CustomIcon ?? (expanded ? FolderOpen : Folder)
  const glyphClass = `icon project-icon${CustomIcon ? '' : ' project-icon--folder'}`
  const chatsId = useId()


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
    void createChat(project.id)
  }

  const otherSpaces = spaces.filter(({ id }) => id !== project.spaceId)

  const openContextMenu = async (event: MouseEvent) => {
    event.preventDefault()
    const row = event.currentTarget
    const action = await showMenu(
      [
        { action: 'create-chat', label: 'New chat', icon: <SquarePen /> },
        ...(branch
          ? [
              {
                action: 'repository',
                label: 'Commits, PRs and Issues',
                icon: <GitPullRequest />
              }
            ]
          : []),
        { type: 'separator' },
        { action: 'rename', label: 'Rename', icon: <Pencil /> },
        colorSubmenu(project.color),
        { action: 'icon', label: 'Icon…', icon: <Shapes /> },
        ...(otherSpaces.length > 0
          ? [
              {
                type: 'submenu' as const,
                label: 'Move to Space',
                icon: <Layers />,
                items: otherSpaces.map((space) => ({
                  action: `${SPACE_ACTION_PREFIX}${space.id}`,
                  label: space.name
                }))
              }
            ]
          : []),
        { action: 'reveal', label: REVEAL_LABEL, icon: <Folder /> },
        { action: 'copy-path', label: 'Copy path', icon: <Copy /> },
        { type: 'separator' },
        { action: 'remove', label: 'Remove from list', icon: <FolderMinus /> }
      ],
      event
    )
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
      case 'repository':
        onOpenRepository(project.id)
        break
      case 'rename':
        setRenaming(true)
        break
      case 'icon':
        setIconPickerAnchor(row)
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
  const projectColor = color && `light-dark(${color.light}, ${color.dark})`
  const colorStyle = projectColor
    ? ({ '--project-color': projectColor } as CSSProperties)
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
            <ProjectGlyph className={glyphClass} />
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
            <ProjectGlyph className={glyphClass} />
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
      {iconPickerAnchor && (
        <IconPicker
          anchor={iconPickerAnchor}
          selected={project.icon}
          color={projectColor}
          onPick={(icon) => void setProjectIcon(project.id, icon)}
          onClose={() => setIconPickerAnchor(null)}
        />
      )}

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
