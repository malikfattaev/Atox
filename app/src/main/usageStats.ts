import { readFile } from 'node:fs/promises'
import { release } from 'node:os'
import { app, net } from 'electron'
import { JsonFileWriter, readVersionedJson } from './jsonFile'
import type { SettingsStore } from './settings'

/**
 * Анонимная статистика в Aptabase: сколько установок и сколько людей пользуются Atox за день,
 * неделю и месяц. Никаких идентификаторов, путей, проектов и текста чатов — только название
 * события, версия приложения и системы. Каждая установка сообщает о себе один раз за период,
 * поэтому число событий за период и есть число активных пользователей.
 */

const STATE_VERSION = 1

/** Как часто проверять, не начался ли новый период: приложение может работать сутками. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

/** Серверы Aptabase по региону из ключа приложения (`A-EU-…`). */
const REGION_HOSTS: Record<string, string> = {
  EU: 'https://eu.aptabase.com',
  US: 'https://us.aptabase.com'
}

const INSTALL_EVENT = 'install'

type Period = 'day' | 'week' | 'month'

const ACTIVITY_EVENTS: Record<Period, string> = {
  day: 'daily_active',
  week: 'weekly_active',
  month: 'monthly_active'
}

interface UsageStatsFile {
  version: typeof STATE_VERSION
  /** Об установке уже сообщили. */
  installReported: boolean
  /** Последний период, о котором сообщили, по каждому виду: `2026-11-05`, `2026-W45`, `2026-11`. */
  reported: Partial<Record<Period, string>>
}

interface SystemProps {
  isDebug: boolean
  locale: string
  osName: string
  osVersion: string
  appVersion: string
  engineName: string
  engineVersion: string
  sdkVersion: string
}

export interface UsageStatsOptions {
  appKey: string
  filePath: string
  settings: SettingsStore
}

export class UsageStats {
  private reporting: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private systemProps: Promise<SystemProps> | null = null
  /** Сессия Aptabase — один запуск приложения. */
  private readonly sessionId = createSessionId()

  private constructor(
    private readonly endpoint: string,
    private readonly appKey: string,
    private readonly settings: SettingsStore,
    private readonly file: JsonFileWriter,
    private readonly state: UsageStatsFile
  ) {}

  /** `null` — ключ приложения не распознан, и статистика не отправляется. */
  static async load({ appKey, filePath, settings }: UsageStatsOptions): Promise<UsageStats | null> {
    const host = REGION_HOSTS[appKey.split('-')[1] ?? '']
    if (!host) {
      console.warn(`Usage stats are disabled: unknown app key "${appKey}"`)
      return null
    }
    const saved = await readVersionedJson<UsageStatsFile>(filePath, STATE_VERSION)
    return new UsageStats(
      `${host}/api/v0/event`,
      appKey,
      settings,
      new JsonFileWriter(filePath),
      {
        version: STATE_VERSION,
        installReported: saved?.installReported === true,
        reported: { ...saved?.reported }
      }
    )
  }

  start(): void {
    void this.report()
    this.timer = setInterval(() => void this.report(), CHECK_INTERVAL_MS)
    this.timer.unref()
    // Статистику включили обратно — о текущем периоде сообщаем сразу, а не через час.
    let enabled = this.settings.get().shareUsageStats
    this.settings.onChange(({ shareUsageStats }) => {
      if (shareUsageStats && !enabled) {
        void this.report()
      }
      enabled = shareUsageStats
    })
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  flush(): Promise<void> {
    return this.file.flush()
  }

  /** Отправляет то, о чём ещё не сообщили; повторный вызов во время отправки ждёт её. */
  private report(): Promise<void> {
    this.reporting ??= this.sendPending().finally(() => {
      this.reporting = null
    })
    return this.reporting
  }

  private async sendPending(): Promise<void> {
    if (!this.settings.get().shareUsageStats) {
      return
    }
    const now = new Date()
    // Отметка ставится только после успешной отправки: без сети событие уйдёт при следующей проверке.
    if (!this.state.installReported && (await this.send(INSTALL_EVENT, now))) {
      this.state.installReported = true
      this.save()
    }
    for (const period of Object.keys(ACTIVITY_EVENTS) as Period[]) {
      const key = periodKey(period, now)
      if (this.state.reported[period] !== key && (await this.send(ACTIVITY_EVENTS[period], now))) {
        this.state.reported[period] = key
        this.save()
      }
    }
  }

  private async send(eventName: string, timestamp: Date): Promise<boolean> {
    try {
      this.systemProps ??= readSystemProps()
      const response = await net.fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'App-Key': this.appKey },
        credentials: 'omit',
        body: JSON.stringify({
          timestamp: timestamp.toISOString(),
          sessionId: this.sessionId,
          eventName,
          systemProps: await this.systemProps,
          props: {}
        })
      })
      if (!response.ok) {
        console.warn(`Failed to send usage event "${eventName}": HTTP ${response.status}`)
      }
      return response.ok
    } catch (error) {
      console.warn(`Failed to send usage event "${eventName}"`, error)
      return false
    }
  }

  private save(): void {
    this.file.write(this.state)
  }
}

/** Ключ периода по UTC, одинаковый для всех часовых поясов. */
export function periodKey(period: Period, date: Date): string {
  const day = date.toISOString().slice(0, 10)
  switch (period) {
    case 'day':
      return day
    case 'month':
      return day.slice(0, 7)
    case 'week': {
      const { year, week } = isoWeek(date)
      return `${year}-W${String(week).padStart(2, '0')}`
    }
  }
}

/** Неделя по ISO 8601: начинается в понедельник, первая неделя года содержит четверг. */
function isoWeek(date: Date): { year: number; week: number } {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7))
  const year = thursday.getUTCFullYear()
  const firstDay = Date.UTC(year, 0, 1)
  const week = Math.floor((thursday.getTime() - firstDay) / (7 * 24 * 60 * 60 * 1000)) + 1
  return { year, week }
}

/** Формат сессии Aptabase: секунды Unix и восемь случайных цифр. */
function createSessionId(): string {
  const seconds = Math.floor(Date.now() / 1000)
  const random = Math.floor(Math.random() * 1e8)
  return `${seconds}${String(random).padStart(8, '0')}`
}

async function readSystemProps(): Promise<SystemProps> {
  const [osName, osVersion] = await readOperatingSystem()
  return {
    isDebug: !app.isPackaged,
    locale: app.getLocale(),
    osName,
    osVersion,
    appVersion: app.getVersion(),
    engineName: 'Chromium',
    engineVersion: process.versions.chrome,
    sdkVersion: `atox@${app.getVersion()}`
  }
}

async function readOperatingSystem(): Promise<[string, string]> {
  switch (process.platform) {
    case 'darwin':
      return ['macOS', process.getSystemVersion()]
    case 'win32':
      return ['Windows', release()]
    default:
      return readLinuxDistribution()
  }
}

/** Название и версия дистрибутива из `/etc/os-release`. */
async function readLinuxDistribution(): Promise<[string, string]> {
  try {
    const fields = new Map<string, string>()
    for (const line of (await readFile('/etc/os-release', 'utf-8')).split('\n')) {
      const separator = line.indexOf('=')
      if (separator > 0) {
        fields.set(line.slice(0, separator), line.slice(separator + 1).replace(/^"|"$/g, ''))
      }
    }
    return [fields.get('NAME') ?? 'Linux', fields.get('VERSION_ID') ?? '']
  } catch {
    return ['Linux', '']
  }
}
