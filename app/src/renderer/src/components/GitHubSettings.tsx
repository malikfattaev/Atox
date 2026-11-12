import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { BOARD_AGENTS } from '../../../shared/board'
import type { GitHubAccount } from '../../../shared/github'
import { useSettings } from '../hooks/SettingsContext'
import { githubAvatarUrl } from '../lib/github'

const { atox } = window

/** Раздел настроек GitHub: учётные записи `gh` и то, сколько агентов доски работают сразу. */
export function GitHubSettings() {
  const { boardMaxAgents } = useSettings()
  const [accounts, setAccounts] = useState<GitHubAccount[] | null>(null)

  useEffect(() => {
    void atox.github.accounts().then(setAccounts)
  }, [])

  const setMaxAgents = (value: number) => void atox.settings.update({ boardMaxAgents: value })

  return (
    <>
      <div className="settings__group">
        <div className="settings__subgroup">
          <h2 className="settings__subgroup-title">Accounts</h2>
          <div className="settings__card">
            {accounts === null ? (
              <div className="settings__row">
                <span className="settings__description">Loading accounts…</span>
              </div>
            ) : accounts.length === 0 ? (
              <div className="settings__row">
                <span className="settings__label">
                  <span>No GitHub accounts</span>
                  <span className="settings__description">
                    Sign in with <code>gh auth login</code> in Terminal, then reopen Settings.
                  </span>
                </span>
              </div>
            ) : (
              accounts.map(({ login, active }) => (
                <div key={login} className="settings__row">
                  <span className="github-account">
                    <img className="github-account__avatar" src={githubAvatarUrl(login)} alt="" />
                    <span className="settings__label">
                      <span>{login}</span>
                      <span className="settings__description">github.com</span>
                    </span>
                  </span>
                  {active && <span className="github-account__badge">Active</span>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="settings__group">
        <div className="settings__subgroup">
          <h2 className="settings__subgroup-title">Board</h2>
          <div className="settings__card">
            <div className="settings__row">
              <span className="settings__label">
                <span>Agents at once</span>
                <span className="settings__description">
                  Queued tasks wait until one of the running agents finishes.
                </span>
              </span>
              <div className="stepper" role="group" aria-label="Agents at once">
                <button
                  type="button"
                  className="stepper__button"
                  aria-label="Fewer agents"
                  disabled={boardMaxAgents <= BOARD_AGENTS.min}
                  onClick={() => setMaxAgents(boardMaxAgents - 1)}
                >
                  <Minus className="stepper__icon" />
                </button>
                <span className="stepper__value" aria-live="polite">
                  {boardMaxAgents}
                </span>
                <button
                  type="button"
                  className="stepper__button"
                  aria-label="More agents"
                  disabled={boardMaxAgents >= BOARD_AGENTS.max}
                  onClick={() => setMaxAgents(boardMaxAgents + 1)}
                >
                  <Plus className="stepper__icon" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
