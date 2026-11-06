import { useEffect, useState } from 'react'
import {
  Archive,
  Plug,
  Puzzle,
  SlidersHorizontal,
  Sparkles,
  X,
  type LucideIcon
} from 'lucide-react'
import { isIntegrationKind, type IntegrationKind } from '../../../shared/integrations'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useSettings } from '../hooks/SettingsContext'
import { useIntegrationLists } from '../hooks/useIntegrationLists'
import { playChime } from '../lib/chime'
import { AgentIntegrations } from './AgentIntegrations'
import { ArchivedChats } from './ArchivedChats'
import { ShortcutList } from './ShortcutList'
import { UpdateSettings } from './UpdateSettings'

const { atox } = window

type SettingsSection = 'general' | IntegrationKind | 'archived'

/** Разделы настроек: общие, то, чем пользуются агенты, — по одному списку на вид, и архив чатов. */
const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string; icon: LucideIcon }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'mcp', label: 'MCP', icon: Plug },
  { id: 'archived', label: 'Archived', icon: Archive }
]

interface SettingsViewProps {
  onClose(): void
}

export function SettingsView({ onClose }: SettingsViewProps) {
  const { shareUsageStats, notificationSounds } = useSettings()
  const { projects, currentProjectId } = useProjectsContext()
  const project = projects.find(({ id }) => id === currentProjectId) ?? null
  const integrations = useIntegrationLists(project?.id ?? null)
  const [section, setSection] = useState<SettingsSection>('general')

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <section className="settings" aria-labelledby="settings-title">
      <header className="settings__header">
        <h1 id="settings-title" className="settings__title">
          Settings
        </h1>
        <button type="button" className="icon-button" aria-label="Close settings" onClick={onClose}>
          <X className="icon" />
        </button>
      </header>

      <div className="settings__group settings__tabs">
        <div className="segmented" role="tablist" aria-label="Section">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="segmented__item"
              aria-selected={section === id}
              onClick={() => setSection(id)}
              // Агенты отвечают по нескольку секунд: спрашиваем, как только курсор над разделом.
              onPointerEnter={() => isIntegrationKind(id) && integrations.load(id)}
            >
              <Icon className="segmented__icon" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {section === 'general' ? (
        <>
          <div className="settings__group">
            <UpdateSettings />
            <section className="settings__subgroup" aria-label="Notifications">
              <h3 className="settings__subgroup-title">Notifications</h3>
              <div className="settings__card">
                <label className="settings__row">
                  <span className="settings__label">
                    <span>Play sounds</span>
                    <span className="settings__description">
                      A soft chime when an agent finishes or needs you.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="switch"
                    checked={notificationSounds}
                    onChange={(event) => {
                      const enabled = event.target.checked
                      // Включённый звук сразу проигрывается: так слышно, каким он будет.
                      if (enabled) {
                        playChime('done')
                      }
                      void atox.settings.update({ notificationSounds: enabled })
                    }}
                  />
                </label>
              </div>
            </section>
            <section className="settings__subgroup" aria-label="Privacy">
              <h3 className="settings__subgroup-title">Privacy</h3>
              <div className="settings__card">
                <label className="settings__row">
                  <span className="settings__label">
                    <span>Share anonymous usage stats</span>
                    <span className="settings__description">
                      Only app version and OS, once a day. No projects, chats or personal data.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="switch"
                    checked={shareUsageStats}
                    onChange={(event) =>
                      void atox.settings.update({ shareUsageStats: event.target.checked })
                    }
                  />
                </label>
              </div>
            </section>
          </div>

          <div className="settings__group">
            <ShortcutList />
          </div>
        </>
      ) : section === 'archived' ? (
        <ArchivedChats />
      ) : (
        <AgentIntegrations
          // Фильтр у каждого раздела свой.
          key={section}
          kind={section}
          lists={integrations}
          projectName={project?.name ?? null}
        />
      )}
    </section>
  )
}
