import type { AgentId } from './agents'
import type { ProjectColor } from './projectColors'
import type { ProjectIcon } from './projectIcons'

export interface Chat {
  id: string
  title: string
  /** Агент, с которым идёт разговор. */
  agent: AgentId
  /** Модель агента; нет — та, что у агента по умолчанию. */
  model?: string
  /** Эффорт модели; нет — её эффорт по умолчанию. */
  effort?: string
  /** Название задал пользователь — первое сообщение его больше не заменяет. */
  hasCustomTitle?: boolean
  /** Чат агента, который запустил этот чат как помощника; нет — чат пользователя. */
  parentChatId?: string
  createdAt: number
  /** Когда чат убрали в архив; есть только у чатов из `Project.archivedChats`. */
  archivedAt?: number
}

/** Пространство, как в Arc: свой набор проектов, например для работы и для личного. */
export interface Space {
  id: string
  name: string
  /** Цвет значка в переключателе; нет — нейтральный. */
  color?: ProjectColor
}

/** Пространства по порядку и то, что открыто сейчас. */
export interface SpacesState {
  spaces: Space[]
  activeSpaceId: string
}

/** Два чата проекта, открытые рядом; сохраняются вместе с проектом. */
export interface ProjectSplit {
  /** Чаты слева направо. */
  chatIds: [string, string]
  /** Доля ширины рабочей области, которую занимает левый чат. */
  position: number
}

export interface Project {
  id: string
  name: string
  /** Абсолютный путь к папке проекта — в ней работают агенты чатов. */
  path: string
  /** Пространство, в котором лежит проект. */
  spaceId: string
  /** Цвет папки в сайдбаре; нет — обычная папка. */
  color?: ProjectColor
  /** Значок вместо папки в сайдбаре, в цвете проекта; нет — обычная папка. */
  icon?: ProjectIcon
  /** Чаты, открытые рядом: у каждого проекта свои. */
  split?: ProjectSplit
  chats: Chat[]
  /**
   * Чаты в архиве: их нет в сайдбаре и у агентов, но история хранится, и чат можно вернуть.
   * Сначала недавно убранные; нет — архив пуст (так и в файлах прежних версий).
   */
  archivedChats?: Chat[]
}

export interface UserProfile {
  /** Имя автора из git, а если его нет — из учётной записи macOS. */
  name: string
}
