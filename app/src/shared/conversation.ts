import type { AgentId } from './agents'

/** Модель агента так, как её отдаёт сам агент: список зависит от его версии и подписки. */
export interface AgentModel {
  /** Идентификатор, который передаётся агенту. */
  id: string
  name: string
  /** Уровни эффорта, которые поддерживает модель; пустой список — выбора нет. */
  efforts: string[]
  /** Эффорт, с которым модель работает, если его не выбрали. */
  defaultEffort?: string
  /** Прежняя или закреплённая версия модели: в меню она убрана в подменю. */
  secondary?: boolean
}

/** Команда, которую можно набрать после «/» в поле ввода. */
export interface AgentCommand {
  name: string
  description: string
  /** Подсказка к аргументам, например `<low|medium|high>`. */
  argumentHint?: string
}

/** Модели установленного агента. */
export interface AgentCatalog {
  agent: AgentId
  models: AgentModel[]
  /** Модель, которую агент берёт по умолчанию. */
  defaultModel: string
}

/**
 * Заполненность контекста разговора, как в `/context`. Лимиты подписки Atox не показывает:
 * агенты сообщают их неполно, а точная картина есть в их собственном `/usage`.
 */
export interface ConversationUsage {
  /** Сколько токенов занимает разговор и сколько вмещает модель. */
  context: { used: number; limit: number }
}

/** Модель и эффорт, выбранные для чата. */
export interface ModelSelection {
  model: string
  effort?: string
}

/** Что можно поменять в чате; `null` — вернуть значение по умолчанию. Агента — только до первого сообщения. */
export interface ChatConfiguration {
  agent?: AgentId
  model?: string | null
  effort?: string | null
}

/** Чем занят инструмент — по этому выбираются значок и сводка «Ran 2 commands». */
export type ToolKind = 'command' | 'read' | 'edit' | 'search' | 'web' | 'agent' | 'other'

export type ToolStatus = 'running' | 'done' | 'failed'

/** Ответ пользователя на запрос разрешения; `cancelled` — агента остановили раньше. */
export type ApprovalStatus = 'pending' | 'allowed' | 'denied' | 'cancelled'

/** Поле вызова, о котором агент спрашивает разрешения: имя параметра и его значение. */
export interface ApprovalField {
  name: string
  value: string
}

export type TimelineItem =
  | {
      kind: 'user'
      id: string
      text: string
      /** Картинки, приложенные к сообщению, — пути к файлам. */
      images?: string[]
      createdAt: number
      /** Когда агент закончил отвечать на это сообщение; нет — ещё работает или ждёт очереди. */
      finishedAt?: number
    }
  | {
      kind: 'assistant'
      id: string
      text: string
      /** Ответ встроенной команды агента (`/usage`, `/context`): переносы строк в нём значимы. */
      commandOutput?: boolean
    }
  | { kind: 'reasoning'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      tool: ToolKind
      /** Имя инструмента у агента, например `Bash` или `commandExecution`. */
      name: string
      /** Главное о вызове: команда, путь к файлу, запрос. */
      title: string
      output?: string
      status: ToolStatus
    }
  | {
      /** Агент ждёт, пока пользователь разрешит или отклонит вызов инструмента. */
      kind: 'approval'
      id: string
      /** Вопрос, например «Allow Claude to use sql write (granite-prod)?». */
      title: string
      /** Пояснение агента: что получит инструмент или почему он спрашивает. */
      description?: string
      /** Что агент передаёт инструменту. */
      fields: ApprovalField[]
      status: ApprovalStatus
    }
  | { kind: 'error'; id: string; message: string }

export type TimelineItemKind = TimelineItem['kind']

/** Поля элемента, которые агент присылает частями, пока пишет ответ. */
export type StreamedField = 'text' | 'output'

/** Всё, что окно знает о разговоре в чате. */
export interface ConversationSnapshot {
  items: TimelineItem[]
  /** Агент сейчас работает над сообщением. */
  running: boolean
  /** Контекст и лимиты по последнему ответу агента; нет — агент ещё не отвечал в этом запуске. */
  usage?: ConversationUsage
  /** Сколько токенов агент написал, отвечая на текущее сообщение. */
  turnTokens?: number
}

export type ConversationEvent =
  /** Новый элемент ленты или новая версия существующего (с тем же `id`). */
  | { chatId: string; type: 'item'; item: TimelineItem }
  /** Продолжение текста элемента, который агент ещё пишет. */
  | {
      chatId: string
      type: 'delta'
      itemId: string
      field: StreamedField
      delta: string
    }
  | { chatId: string; type: 'running'; running: boolean }
  | { chatId: string; type: 'usage'; usage: ConversationUsage }
  | { chatId: string; type: 'tokens'; turnTokens: number }

export const EMPTY_CONVERSATION: ConversationSnapshot = {
  items: [],
  running: false
}

/**
 * Сколько вывода команды хранить: длинная сборка или лог печатают мегабайты, а в ленте
 * важен конец — там ошибка или итог.
 */
export const TOOL_OUTPUT_LIMIT = 64 * 1024

/** Применяет событие к разговору, не изменяя исходный снимок. */
export function applyConversationEvent(
  snapshot: ConversationSnapshot,
  event: ConversationEvent
): ConversationSnapshot {
  switch (event.type) {
    case 'running':
      return snapshot.running === event.running ? snapshot : { ...snapshot, running: event.running }
    case 'usage':
      return { ...snapshot, usage: event.usage }
    case 'tokens':
      return { ...snapshot, turnTokens: event.turnTokens }
    case 'item': {
      // Обновляются почти всегда последние элементы ленты: ищем с конца.
      const index = snapshot.items.findLastIndex(({ id }) => id === event.item.id)
      const items =
        index < 0 ? [...snapshot.items, event.item] : snapshot.items.with(index, event.item)
      return { ...snapshot, items }
    }
    case 'delta': {
      const index = snapshot.items.findLastIndex(({ id }) => id === event.itemId)
      const item = snapshot.items[index]
      if (!item) {
        return snapshot
      }
      const updated = appendToField(item, event.field, event.delta)
      return updated === item
        ? snapshot
        : {
            ...snapshot,
            items: snapshot.items.with(index, updated)
          }
    }
  }
}

function appendToField(item: TimelineItem, field: StreamedField, delta: string): TimelineItem {
  if (field === 'text' && (item.kind === 'assistant' || item.kind === 'reasoning')) {
    return { ...item, text: item.text + delta }
  }
  if (field === 'output' && item.kind === 'tool') {
    return { ...item, output: limitOutput((item.output ?? '') + delta) }
  }
  return item
}

/** Оставляет конец вывода, если он длиннее лимита. */
export function limitOutput(output: string): string {
  return output.length > TOOL_OUTPUT_LIMIT ? output.slice(-TOOL_OUTPUT_LIMIT) : output
}

/** Длина названия чата, которое берётся из первого сообщения. */
const TITLE_LENGTH = 60

/** Название чата из первого сообщения: его первая непустая строка. */
export function titleFromMessage(text: string): string {
  const line =
    text
      .split('\n')
      .find((part) => part.trim())
      ?.trim() ?? ''
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : line
}
