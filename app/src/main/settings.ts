import { AGENTS, DEFAULT_AGENT_ID, isAgentId, type AgentCommands } from '../shared/agents'
import {
  clampSidebarWidth,
  DEFAULT_SETTINGS,
  TERMINAL_FONT_SIZE,
  type Settings
} from '../shared/settings'
import {
  canonicalAccelerator,
  findShortcutConflict,
  isValidAccelerator,
  SHORTCUTS,
  type Shortcut,
  type ShortcutId,
  type ShortcutOverrides
} from '../shared/shortcuts'
import { JsonFileWriter, readVersionedJson } from './jsonFile'

const SETTINGS_VERSION = 1

interface SettingsFile extends Partial<Settings> {
  version: typeof SETTINGS_VERSION
}

/** Настройки приложения; недостающие в файле значения берутся по умолчанию. */
export class SettingsStore {
  private readonly listeners = new Set<(settings: Settings) => void>()

  private constructor(
    private readonly file: JsonFileWriter,
    private settings: Settings
  ) {}

  static async load(filePath: string): Promise<SettingsStore> {
    const { version: _version, ...saved } =
      (await readVersionedJson<SettingsFile>(filePath, SETTINGS_VERSION)) ?? {}
    return new SettingsStore(
      new JsonFileWriter(filePath),
      normalize({ ...DEFAULT_SETTINGS, ...saved })
    )
  }

  get(): Settings {
    return this.settings
  }

  update(patch: Partial<Settings>): Settings {
    this.settings = normalize({ ...this.settings, ...patch })
    const data: SettingsFile = { version: SETTINGS_VERSION, ...this.settings }
    this.file.write(data)
    this.listeners.forEach((listener) => listener(this.settings))
    return this.settings
  }

  onChange(listener: (settings: Settings) => void): void {
    this.listeners.add(listener)
  }

  flush(): Promise<void> {
    return this.file.flush()
  }
}

/** Приводит значения к допустимым: файл мог быть отредактирован вручную. */
function normalize(settings: Settings): Settings {
  const fontSize = Number.isFinite(settings.terminalFontSize)
    ? Math.round(settings.terminalFontSize)
    : TERMINAL_FONT_SIZE.default
  return {
    terminalFontSize: Math.min(TERMINAL_FONT_SIZE.max, Math.max(TERMINAL_FONT_SIZE.min, fontSize)),
    defaultAgent: isAgentId(settings.defaultAgent) ? settings.defaultAgent : DEFAULT_AGENT_ID,
    agentCommands: normalizeAgentCommands(settings.agentCommands),
    sidebarWidth: clampSidebarWidth(settings.sidebarWidth),
    shortcuts: normalizeShortcuts(settings.shortcuts)
  }
}

/**
 * Оставляет свои сочетания только у переназначаемых действий, если сочетание допустимо,
 * отличается от стандартного и не занято другим действием.
 */
function normalizeShortcuts(shortcuts: unknown): ShortcutOverrides {
  const source = typeof shortcuts === 'object' && shortcuts !== null ? shortcuts : {}
  const normalized: ShortcutOverrides = {}
  for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
    const shortcut: Shortcut = SHORTCUTS[id]
    const value = (source as Record<string, unknown>)[id]
    if (
      shortcut.accelerator &&
      typeof value === 'string' &&
      isValidAccelerator(value) &&
      canonicalAccelerator(value) !== canonicalAccelerator(shortcut.accelerator) &&
      !findShortcutConflict(id, value, normalized)
    ) {
      normalized[id] = canonicalAccelerator(value)
    }
  }
  return normalized
}

/** Оставляет только непустые команды известных агентов. */
function normalizeAgentCommands(commands: unknown): AgentCommands {
  const source = typeof commands === 'object' && commands !== null ? commands : {}
  const normalized: AgentCommands = {}
  for (const { id } of AGENTS) {
    const command = (source as Record<string, unknown>)[id]
    if (typeof command === 'string' && command.trim()) {
      normalized[id] = command.trim()
    }
  }
  return normalized
}
