export interface Chat {
  id: string
  title: string
  createdAt: number
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
