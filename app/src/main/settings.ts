import { AGENTS, DEFAULT_AGENT_ID, isAgentId } from '../shared/agents'
import {
  clampWidth,
  DEFAULT_SETTINGS,
  SIDEBAR_WIDTH,
  TERMINAL_WIDTH,
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
  return {
    defaultAgent: isAgentId(settings.defaultAgent) ? settings.defaultAgent : DEFAULT_AGENT_ID,
    agentModels: normalizeAgentModels(settings.agentModels),
    sidebarWidth: clampWidth(settings.sidebarWidth, SIDEBAR_WIDTH),
    terminalWidth: clampWidth(settings.terminalWidth, TERMINAL_WIDTH),
    shortcuts: normalizeShortcuts(settings.shortcuts),
    shareUsageStats: settings.shareUsageStats !== false,
    playSounds: settings.playSounds === true
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

/** Оставляет выбор моделей только известных агентов и только строковые значения. */
function normalizeAgentModels(value: unknown): Settings['agentModels'] {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const normalized: Settings['agentModels'] = {}
  for (const { id } of AGENTS) {
    const selection = source[id]
    if (typeof selection !== 'object' || selection === null) {
      continue
    }
    const { model, effort } = selection as Record<string, unknown>
    normalized[id] = {
      ...(typeof model === 'string' && model && { model }),
      ...(typeof effort === 'string' && effort && { effort })
    }
  }
  return normalized
}
