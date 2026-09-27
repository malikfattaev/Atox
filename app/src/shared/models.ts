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
