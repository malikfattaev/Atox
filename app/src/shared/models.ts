import type { AgentId } from './agents'

export interface Chat {
  id: string
  title: string
  /** Агент, который запускается в терминале чата; нет — пустой терминал. */
  agent?: AgentId
  /** Название задал пользователь — заголовок терминала его больше не перезаписывает. */
  hasCustomTitle?: boolean
  createdAt: number
  /** Когда программа в чате последний раз закончила работу (мс с начала эпохи). */
  lastActiveAt?: number
}

export interface Project {
  id: string
  name: string
  /** Абсолютный путь к папке проекта — в ней открываются терминалы чатов. */
  path: string
  chats: Chat[]
}

export interface UserProfile {
  /** Имя автора из git, а если его нет — из учётной записи macOS. */
  name: string
}
