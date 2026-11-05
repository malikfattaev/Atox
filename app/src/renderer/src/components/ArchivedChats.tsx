import { useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import { findAgent } from '../../../shared/agents'
import { archivedChats, archiveEntries, workerChats } from '../../../shared/chats'
import type { Chat, Project } from '../../../shared/models'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { formatFullDate, formatRelativeTime } from '../lib/relativeTime'
import { AgentIcon } from './AgentIcon'

interface ArchivedChat {
  chat: Chat
  /** Помощники, убранные в архив вместе с чатом, — вернутся с ним. */
  workerCount: number
}

interface ProjectArchive {
  project: Project
  chats: ArchivedChat[]
}

/** Раздел настроек: чаты в архиве по проектам, сначала недавно убранные. */
export function ArchivedChats() {
  const { projects, restoreChat, removeArchivedChat } = useProjectsContext()
  const archives = useMemo(() => projectArchives(projects), [projects])
  const now = Date.now()

  if (archives.length === 0) {
    return (
      <div className="settings__group">
        <div className="settings__card">
          <div className="settings__row archived__empty">
            <span className="settings__label">
              <span>No archived chats</span>
              <span className="settings__description">
                Archived chats leave the sidebar and keep their history until you restore them.
              </span>
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="settings__group">
      {archives.map(({ project, chats }) => (
        <section key={project.id} className="settings__subgroup" aria-label={project.name}>
          <h3 className="settings__subgroup-title">{project.name}</h3>
          <ul className="settings__card archived__list">
            {chats.map(({ chat, workerCount }) => (
              <li key={chat.id} className="settings__row settings__row--compact">
                <span className="archived__chat" title={findAgent(chat.agent)?.name}>
                  <AgentIcon agent={chat.agent} className="archived__agent" aria-hidden />
                  <span className="row__label">{chat.title}</span>
                  {workerCount > 0 && (
                    <span className="archived__meta">
                      {workerCount === 1 ? '1 agent' : `${workerCount} agents`}
                    </span>
                  )}
                </span>
                <span className="archived__actions">
                  {chat.archivedAt !== undefined && (
                    <time className="archived__meta" title={formatFullDate(chat.archivedAt)}>
                      {formatRelativeTime(chat.archivedAt, now)}
                    </time>
                  )}
                  <button
                    type="button"
                    className="settings__button"
                    onClick={() => void restoreChat(chat.id)}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Delete"
                    title="Delete"
                    onClick={() => void removeArchivedChat(chat.id)}
                  >
                    <Trash2 className="icon" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** Проекты с архивом: и проекты, и чаты в них — от недавно убранных к давним. */
function projectArchives(projects: readonly Project[]): ProjectArchive[] {
  return projects
    .flatMap((project) => {
      const archived = archivedChats(project)
      const chats = archiveEntries(archived)
        .map((chat) => ({ chat, workerCount: workerChats(archived, chat.id).length }))
        .sort((a, b) => archivedTime(b.chat) - archivedTime(a.chat))
      return chats.length > 0 ? [{ project, chats }] : []
    })
    .sort((a, b) => archivedTime(b.chats[0]!.chat) - archivedTime(a.chats[0]!.chat))
}

function archivedTime(chat: Chat): number {
  return chat.archivedAt ?? chat.createdAt
}
