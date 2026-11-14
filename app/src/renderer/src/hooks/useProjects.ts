import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentId } from '../../../shared/agents'
import type { ChatConfiguration } from '../../../shared/conversation'
import { moveChatGroup, topLevelChats } from '../../../shared/chats'
import { moveItemWithinGroup } from '../../../shared/list'
import type { Project, Space } from '../../../shared/models'
import type { ProjectColor } from '../../../shared/projectColors'
import type { ProjectIcon } from '../../../shared/projectIcons'
import {
  EMPTY_LAYOUT,
  hideChat,
  isSameSplit,
  layoutFromSplit,
  showChat,
  showChatBeside,
  splitChatIds,
  type ChatLayout
} from '../lib/chatLayout'
import { useSpaces } from './useSpaces'

const { atox } = window

/**
 * Что открыто в рабочей области. Раскладка своя у каждого проекта: при переходе в другой
 * проект его чаты, открытые рядом, возвращаются, а у прежнего сохраняются до возвращения.
 * Так же и с пространствами: в каждом на экране остаётся свой проект.
 */
interface WorkspaceView {
  /** Проект на экране в каждом пространстве (по id пространства). */
  shownProjectIds: Readonly<Record<string, string>>
  layouts: Readonly<Record<string, ChatLayout>>
}

const INITIAL_VIEW: WorkspaceView = { shownProjectIds: {}, layouts: {} }

/**
 * Сколько недавно открытых чатов держать смонтированными, кроме тех, что на экране. Возврат
 * в них мгновенный; остальные выгружаются, чтобы окно не держало ленты всех чатов сессии.
 */
const MAX_MOUNTED_CHATS = 5

/** Недавно открытые чаты, самые свежие в конце; чаты на экране остаются всегда. */
function rememberOpenedChats(ids: string[], visible: readonly string[]): string[] {
  const recent = [...ids.filter((id) => !visible.includes(id)), ...visible]
  const next = recent.slice(-Math.max(MAX_MOUNTED_CHATS, visible.length))
  return next.length === ids.length && next.every((id, index) => id === ids[index]) ? ids : next
}

/** Данные проектов и того, что открыто на экране. */
export interface ProjectsData {
  /** Проекты всех пространств. */
  projects: Project[]
  /** Проекты и пространства ещё загружаются — пустой список пока ничего не значит. */
  loading: boolean
  /**
   * Сколько раз выбирали чат. Выбор уже активного чата ничего не меняет в данных, но страница
   * поверх чатов — репозиторий, доска — должна закрыться и по нему.
   */
  chatSelections: number
  spaces: Space[]
  /** `null` — пространства ещё загружаются. */
  activeSpaceId: string | null
  /** Проекты открытого пространства — их и показывает сайдбар. */
  spaceProjects: Project[]
  /** Чат в фокусе: к нему относятся поиск, закрытие и переключение с клавиатуры. */
  activeChatId: string | null
  /** Чаты на экране слева направо; два — когда чаты открыты рядом. */
  visibleChatIds: string[]
  /**
   * Недавно открытые чаты, самые свежие в конце: остаются смонтированными, и возврат в них
   * мгновенный. Черновик и прокрутка выгруженных чатов хранятся отдельно и не теряются.
   */
  openedChatIds: string[]
  /**
   * Чаты открытого пространства в порядке сайдбара — по ним работает переключение
   * с клавиатуры. Помощники не входят: они открываются из карточки своего агента.
   */
  orderedChatIds: string[]
  /** Проект текущего чата, а если чат не выбран — первый проект открытого пространства. */
  currentProjectId: string | null
}

/** Действия с проектами; ссылки на них не меняются, поэтому подписка на них не перерисовывает. */
export interface ProjectActions {
  selectSpace(spaceId: string): void
  /** Создаёт пространство, открывает его и возвращает его id. */
  createSpace(): Promise<string>
  renameSpace(spaceId: string, name: string): Promise<void>
  setSpaceColor(spaceId: string, color: ProjectColor | null): Promise<void>
  /** Удаляет пространство; его проекты переходят в соседнее. */
  removeSpace(spaceId: string): Promise<void>
  moveProjectToSpace(projectId: string, spaceId: string): Promise<void>
  /** Открывает чат на месте того, что в фокусе; уже видимый чат просто получает фокус. */
  selectChat(chatId: string): void
  /** Открывает чат рядом с тем, что в фокусе; чат другого проекта открывается вместо него. */
  openChatBeside(chatId: string): void
  /** Убирает чат с экрана, когда чаты открыты рядом; сам чат остаётся в списке. */
  closeChatPane(chatId: string): void
  addProject(): Promise<void>
  removeProject(projectId: string): Promise<void>
  renameProject(projectId: string, name: string): Promise<void>
  setProjectColor(projectId: string, color: ProjectColor | null): Promise<void>
  setProjectIcon(projectId: string, icon: ProjectIcon | null): Promise<void>
  /** Положение разделителя между чатами проекта, открытыми рядом. */
  setSplitPosition(projectId: string, position: number): Promise<void>
  moveProject(projectId: string, toIndex: number): Promise<void>
  revealProject(projectId: string): Promise<void>
  /** Без агента чат создаётся с агентом по умолчанию. Возвращает id нового чата. */
  createChat(projectId: string, agent?: AgentId): Promise<string>
  /** Копия чата с его разговором; открывается сразу, под исходным чатом. */
  forkChat(chatId: string): Promise<void>
  removeChat(chatId: string): Promise<void>
  /** Убирает чат с помощниками в архив: из сайдбара он пропадает, история остаётся. */
  archiveChat(chatId: string): Promise<void>
  /** Возвращает чат из архива в сайдбар, не открывая его. */
  restoreChat(chatId: string): Promise<void>
  /** Удаляет чат из архива насовсем. */
  removeArchivedChat(chatId: string): Promise<void>
  renameChat(chatId: string, title: string): Promise<void>
  moveChat(chatId: string, toIndex: number): Promise<void>
  /** Меняет агента, модель или эффорт чата. */
  configureChat(chatId: string, configuration: ChatConfiguration): Promise<void>
}

export type ProjectsState = ProjectsData & ProjectActions

export function useProjects(): { state: ProjectsState; actions: ProjectActions } {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [view, setView] = useState<WorkspaceView>(INITIAL_VIEW)
  const [openedChatIds, setOpenedChatIds] = useState<string[]>([])
  // Действия читают и меняют состояние сразу, не дожидаясь отрисовки: например, новый чат
  // открывается в том же вызове, в котором пришёл обновлённый список проектов.
  const projectsRef = useRef(projects)
  const viewRef = useRef(view)
  const {
    spaces,
    activeSpaceId,
    selectSpace,
    createSpace,
    renameSpace,
    setSpaceColor,
    removeSpace: removeSpaceReturningProjects
  } = useSpaces()
  const activeSpaceIdRef = useRef(activeSpaceId)
  activeSpaceIdRef.current = activeSpaceId

  const spaceProjects = useMemo(
    () => projects.filter((project) => project.spaceId === activeSpaceId),
    [projects, activeSpaceId]
  )
  const shownProjectId = findShownProjectId(view, projects, activeSpaceId)
  const layout = (shownProjectId && view.layouts[shownProjectId]) || EMPTY_LAYOUT
  const { visibleChatIds, activeChatId } = layout

  const orderedChatIds = useMemo(
    () => spaceProjects.flatMap((project) => topLevelChats(project.chats).map(({ id }) => id)),
    [spaceProjects]
  )

  const currentProjectId = shownProjectId ?? spaceProjects[0]?.id ?? null

  const commitView = useCallback((next: WorkspaceView) => {
    viewRef.current = next
    setView(next)
  }, [])

  /** Применяет свежий список проектов и забывает чаты, которых в нём больше нет. */
  const applyProjects = useCallback(
    (received: Project[]) => {
      // Из main каждый раз приходят новые объекты: неизменившиеся заменяем прежними, чтобы
      // строки сайдбара и открытые чаты не перерисовывались из-за чужих изменений.
      const next = reuseUnchanged(projectsRef.current, received)
      if (next === projectsRef.current) {
        return
      }
      projectsRef.current = next
      setProjects(next)
      const existingChatIds = new Set(next.flatMap((project) => project.chats.map(({ id }) => id)))
      setOpenedChatIds((ids) =>
        ids.every((id) => existingChatIds.has(id))
          ? ids
          : ids.filter((id) => existingChatIds.has(id))
      )

      // Удалённый чат пропадает с экрана; если рядом открыт второй, фокус переходит к нему.
      const current = viewRef.current
      const layouts = Object.fromEntries(
        next.flatMap((project) => {
          const layout = current.layouts[project.id]
          if (!layout) {
            return []
          }
          const removed = layout.visibleChatIds.filter((id) => !existingChatIds.has(id))
          return [[project.id, removed.reduce(hideChat, layout)]]
        })
      )
      // Проект на экране остаётся, только пока он существует и лежит в том же пространстве.
      const shownProjectIds = Object.fromEntries(
        Object.entries(current.shownProjectIds).filter(([spaceId, projectId]) =>
          next.some((project) => project.id === projectId && project.spaceId === spaceId)
        )
      )
      commitView({ shownProjectIds, layouts })
    },
    [commitView]
  )

  useEffect(() => {
    void atox.projects.list().then((next) => {
      applyProjects(next)
      setProjectsLoaded(true)
    })
    return atox.chats.onChanged(applyProjects)
  }, [applyProjects])

  /**
   * Меняет раскладку проекта и показывает его, открыв его пространство. Чаты, открытые рядом,
   * сохраняются у проекта, поэтому после перезапуска они снова откроются вместе.
   */
  const changeLayout = useCallback(
    (projectId: string, change: (layout: ChatLayout) => ChatLayout) => {
      const current = viewRef.current
      const project = projectsRef.current.find(({ id }) => id === projectId)
      if (!project) {
        return
      }
      const before = current.layouts[projectId] ?? layoutFromSplit(project.split)
      const after = change(before)
      const alreadyShown =
        project.spaceId === activeSpaceIdRef.current &&
        current.shownProjectIds[project.spaceId] === projectId
      if (after === before && alreadyShown) {
        return
      }
      commitView({
        shownProjectIds: { ...current.shownProjectIds, [project.spaceId]: projectId },
        layouts: { ...current.layouts, [projectId]: after }
      })
      setOpenedChatIds((ids) => rememberOpenedChats(ids, after.visibleChatIds))
      // Чат из другого пространства (например, по клику на уведомление) открывает и его.
      selectSpace(project.spaceId)

      const split = splitChatIds(after)
      if (!isSameSplit(project.split?.chatIds, split)) {
        void atox.projects.setSplit(projectId, split).then(applyProjects)
      }
    },
    [commitView, applyProjects, selectSpace]
  )

  /** Проект на экране в открытом пространстве — для действий, которые читают состояние сразу. */
  const currentShownProjectId = () =>
    findShownProjectId(viewRef.current, projectsRef.current, activeSpaceIdRef.current)

  const [chatSelections, setChatSelections] = useState(0)

  const selectChat = useCallback(
    (chatId: string) => {
      setChatSelections((count) => count + 1)
      const projectId = findChatProjectId(projectsRef.current, chatId)
      if (projectId) {
        changeLayout(projectId, (layout) => showChat(layout, chatId))
      }
    },
    [changeLayout]
  )

  // Рядом открываются только чаты одного проекта: раскладка принадлежит проекту.
  const openChatBeside = useCallback(
    (chatId: string) => {
      const projectId = findChatProjectId(projectsRef.current, chatId)
      if (projectId) {
        const sameProject = projectId === currentShownProjectId()
        changeLayout(projectId, (layout) =>
          sameProject ? showChatBeside(layout, chatId) : showChat(layout, chatId)
        )
      }
    },
    [changeLayout]
  )

  const closeChatPane = useCallback(
    (chatId: string) => {
      const projectId = currentShownProjectId()
      if (projectId) {
        changeLayout(projectId, (layout) => hideChat(layout, chatId))
      }
    },
    [changeLayout]
  )

  // Чат в фокусе запоминается у его пространства — после перезапуска откроется он же.
  useEffect(() => {
    if (activeChatId) {
      atox.spaces.rememberChat(activeChatId)
    }
  }, [activeChatId])

  // Пространство, впервые открытое за сессию (в том числе при запуске), показывает чат, который
  // был в нём последним. Дальше на экране остаётся то, что открыл пользователь.
  const restoredSpaceIdsRef = useRef(new Set<string>())
  useEffect(() => {
    if (!projectsLoaded || !activeSpaceId || restoredSpaceIdsRef.current.has(activeSpaceId)) {
      return
    }
    restoredSpaceIdsRef.current.add(activeSpaceId)
    if (viewRef.current.shownProjectIds[activeSpaceId]) {
      return
    }
    const lastChatId = spaces.find(({ id }) => id === activeSpaceId)?.lastChatId
    const projectId = lastChatId && findChatProjectId(projectsRef.current, lastChatId)
    const project = projectsRef.current.find(({ id }) => id === projectId)
    if (lastChatId && project?.spaceId === activeSpaceId) {
      selectChat(lastChatId)
    }
  }, [projectsLoaded, activeSpaceId, spaces, selectChat])

  const createChat = useCallback(
    async (projectId: string, agent?: AgentId) => {
      const { projects: next, chatId } = await atox.chats.create(projectId, agent)
      applyProjects(next)
      selectChat(chatId)
      return chatId
    },
    [applyProjects, selectChat]
  )

  const addProject = useCallback(async () => {
    const spaceId = activeSpaceIdRef.current
    if (!spaceId) {
      return
    }
    const result = await atox.projects.add(spaceId)
    if (!result) {
      return
    }
    applyProjects(result.projects)

    // Новый проект сразу открывается в чате — меньше кликов до работающего терминала.
    const project = result.projects.find(({ id }) => id === result.projectId)
    const [latestChat] = project?.chats ?? []
    if (latestChat) {
      selectChat(latestChat.id)
    } else {
      await createChat(result.projectId)
    }
  }, [applyProjects, createChat, selectChat])

  const removeProject = useCallback(
    async (projectId: string) => applyProjects(await atox.projects.remove(projectId)),
    [applyProjects]
  )

  const renameProject = useCallback(
    async (projectId: string, name: string) =>
      applyProjects(await atox.projects.rename(projectId, name)),
    [applyProjects]
  )

  const setProjectColor = useCallback(
    async (projectId: string, color: ProjectColor | null) =>
      applyProjects(await atox.projects.setColor(projectId, color)),
    [applyProjects]
  )

  const setProjectIcon = useCallback(
    async (projectId: string, icon: ProjectIcon | null) =>
      applyProjects(await atox.projects.setIcon(projectId, icon)),
    [applyProjects]
  )

  const setSplitPosition = useCallback(
    async (projectId: string, position: number) =>
      applyProjects(await atox.projects.setSplitPosition(projectId, position)),
    [applyProjects]
  )

  /**
   * Применяет перенос сразу, не дожидаясь main-процесса: иначе брошенный элемент на мгновение
   * вернулся бы на старое место. Если main перенос не принял, список перечитывается — элемент
   * возвращается туда, где он на самом деле лежит.
   */
  const moveOptimistically = useCallback(
    async (move: (current: Project[]) => Project[] | null, save: () => Promise<Project[]>) => {
      const moved = move(projectsRef.current)
      if (moved) {
        applyProjects(moved)
      }
      try {
        applyProjects(await save())
      } catch (error) {
        applyProjects(await atox.projects.list())
        throw error
      }
    },
    [applyProjects]
  )

  const moveProject = useCallback(
    (projectId: string, toIndex: number) =>
      moveOptimistically(
        (current) =>
          moveItemWithinGroup(
            current,
            current.findIndex(({ id }) => id === projectId),
            toIndex,
            (a, b) => a.spaceId === b.spaceId
          ),
        () => atox.projects.move(projectId, toIndex)
      ),
    [moveOptimistically]
  )

  const moveProjectToSpace = useCallback(
    async (projectId: string, spaceId: string) =>
      applyProjects(await atox.projects.moveToSpace(projectId, spaceId)),
    [applyProjects]
  )

  // Проекты удалённого пространства переезжают в соседнее — список проектов тоже обновляется.
  const removeSpace = useCallback(
    async (spaceId: string) => {
      const next = await removeSpaceReturningProjects(spaceId)
      if (next) {
        applyProjects(next)
      }
    },
    [removeSpaceReturningProjects, applyProjects]
  )

  const revealProject = useCallback((projectId: string) => atox.projects.reveal(projectId), [])

  const forkChat = useCallback(
    async (chatId: string) => {
      const { projects: next, chatId: forkId } = await atox.chats.fork(chatId)
      applyProjects(next)
      selectChat(forkId)
    },
    [applyProjects, selectChat]
  )

  const removeChat = useCallback(
    async (chatId: string) => applyProjects(await atox.chats.remove(chatId)),
    [applyProjects]
  )

  // Чат в архиве пропадает с экрана так же, как удалённый.
  const archiveChat = useCallback(
    async (chatId: string) => applyProjects(await atox.chats.archive(chatId)),
    [applyProjects]
  )

  // Чат возвращается в сайдбар, но не открывается: архив смотрят в настройках, и переход
  // в чат закрыл бы их посреди разбора — можно вернуть несколько чатов подряд.
  const restoreChat = useCallback(
    async (chatId: string) => applyProjects(await atox.chats.restore(chatId)),
    [applyProjects]
  )

  const removeArchivedChat = useCallback(
    async (chatId: string) => applyProjects(await atox.chats.removeArchived(chatId)),
    [applyProjects]
  )

  const renameChat = useCallback(
    async (chatId: string, title: string) => applyProjects(await atox.chats.rename(chatId, title)),
    [applyProjects]
  )

  const moveChat = useCallback(
    (chatId: string, toIndex: number) =>
      moveOptimistically(
        (current) => {
          let changed = false
          const next = current.map((project) => {
            const chats = moveChatGroup(project.chats, chatId, toIndex)
            changed ||= chats !== null
            return chats ? { ...project, chats } : project
          })
          return changed ? next : null
        },
        () => atox.chats.move(chatId, toIndex)
      ),
    [moveOptimistically]
  )

  const configureChat = useCallback(
    async (chatId: string, configuration: ChatConfiguration) =>
      applyProjects(await atox.chats.configure(chatId, configuration)),
    [applyProjects]
  )

  const loading = !projectsLoaded || activeSpaceId === null

  const actions = useMemo<ProjectActions>(
    () => ({
      selectSpace,
      createSpace,
      renameSpace,
      setSpaceColor,
      removeSpace,
      moveProjectToSpace,
      selectChat,
      openChatBeside,
      closeChatPane,
      addProject,
      removeProject,
      renameProject,
      setProjectColor,
      setProjectIcon,
      setSplitPosition,
      moveProject,
      revealProject,
      createChat,
      forkChat,
      removeChat,
      archiveChat,
      restoreChat,
      removeArchivedChat,
      renameChat,
      moveChat,
      configureChat
    }),
    [
      selectSpace,
      createSpace,
      renameSpace,
      setSpaceColor,
      removeSpace,
      moveProjectToSpace,
      selectChat,
      openChatBeside,
      closeChatPane,
      addProject,
      removeProject,
      renameProject,
      setProjectColor,
      setProjectIcon,
      setSplitPosition,
      moveProject,
      revealProject,
      createChat,
      forkChat,
      removeChat,
      archiveChat,
      restoreChat,
      removeArchivedChat,
      renameChat,
      moveChat,
      configureChat
    ]
  )

  const state = useMemo<ProjectsState>(
    () => ({
      projects,
      loading,
      chatSelections,
      spaces,
      activeSpaceId,
      spaceProjects,
      activeChatId,
      visibleChatIds,
      openedChatIds,
      orderedChatIds,
      currentProjectId,
      ...actions
    }),
    [
      projects,
      loading,
      chatSelections,
      spaces,
      activeSpaceId,
      spaceProjects,
      activeChatId,
      visibleChatIds,
      openedChatIds,
      orderedChatIds,
      currentProjectId,
      actions
    ]
  )

  return { state, actions }
}

function findChatProjectId(projects: readonly Project[], chatId: string): string | undefined {
  return projects.find(({ chats }) => chats.some(({ id }) => id === chatId))?.id
}

/** Проект на экране в пространстве, если он всё ещё существует и лежит в нём. */
function findShownProjectId(
  view: WorkspaceView,
  projects: readonly Project[],
  spaceId: string | null
): string | null {
  const projectId = spaceId ? view.shownProjectIds[spaceId] : undefined
  return projects.some((project) => project.id === projectId && project.spaceId === spaceId)
    ? projectId!
    : null
}

/**
 * Свежий список проектов, в котором неизменившиеся проекты и чаты — прежние объекты.
 * Если не изменилось ничего, возвращается сам прежний список.
 */
function reuseUnchanged(previous: Project[], next: readonly Project[]): Project[] {
  const previousById = new Map(previous.map((project) => [project.id, project]))
  return reuseList(
    previous,
    next.map((project) => {
      const old = previousById.get(project.id)
      if (!old) {
        return project
      }
      const candidate: Project = { ...project, chats: reuseList(old.chats, project.chats) }
      if (project.archivedChats) {
        candidate.archivedChats = reuseList(old.archivedChats ?? [], project.archivedChats)
      }
      return isSameData(old, candidate) ? old : candidate
    })
  )
}

/** Список, где элементы, равные прежним с тем же id, заменены прежними. */
function reuseList<Item extends { id: string }>(previous: Item[], next: readonly Item[]): Item[] {
  const previousById = new Map(previous.map((item) => [item.id, item]))
  const items = next.map((item) => {
    const old = previousById.get(item.id)
    return old && isSameData(old, item) ? old : item
  })
  const unchanged =
    items.length === previous.length && items.every((item, index) => item === previous[index])
  return unchanged ? previous : items
}

/** Сравнивает данные из JSON по содержимому; одинаковые ссылки сравниваются сразу. */
function isSameData(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false
  }
  const aEntries = Object.entries(a)
  const bRecord = b as Record<string, unknown>
  return (
    aEntries.length === Object.keys(b).length &&
    aEntries.every(([key, value]) => key in bRecord && isSameData(value, bRecord[key]))
  )
}
