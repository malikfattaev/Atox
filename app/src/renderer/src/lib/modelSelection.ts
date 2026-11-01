import type { AgentCatalog, AgentModel, ChatConfiguration } from '../../../shared/conversation'
import type { Chat } from '../../../shared/models'
import { effortLabel } from './conversationText'

/** Слово, которым в `/effort` выбирают эффорт модели по умолчанию. */
export const DEFAULT_EFFORT_ARGUMENT = 'default'

export function findModel(catalog: AgentCatalog, id: string): AgentModel | undefined {
  return catalog.models.find((model) => model.id === id)
}

/** Модель чата: выбранная или та, что у агента по умолчанию. */
export function currentModel(chat: Chat, catalog: AgentCatalog): AgentModel | undefined {
  return findModel(catalog, chat.model ?? catalog.defaultModel)
}

/**
 * Смена модели. Эффорт, которого у новой модели нет, сбрасывается на её эффорт по умолчанию.
 */
export function modelConfiguration(
  chat: Chat,
  catalog: AgentCatalog,
  modelId: string
): ChatConfiguration {
  const next = findModel(catalog, modelId)
  const keepEffort = chat.effort !== undefined && next?.efforts.includes(chat.effort)
  return { model: modelId, ...(!keepEffort && { effort: null }) }
}

/** Модель по тексту из `/model`: идентификатор или название, например `opus` или `Opus 5.5`. */
export function matchModel(catalog: AgentCatalog, query: string): AgentModel | undefined {
  const wanted = normalize(query)
  return (
    catalog.models.find(({ id, name }) => normalize(id) === wanted || normalize(name) === wanted) ??
    catalog.models.find(({ name }) => normalize(name).startsWith(wanted))
  )
}

/**
 * Эффорт по тексту из `/effort`: уровень или его название; `null` — эффорт по умолчанию,
 * `undefined` — такого уровня у модели нет.
 */
export function matchEffort(model: AgentModel, query: string): string | null | undefined {
  const wanted = normalize(query)
  if (wanted === DEFAULT_EFFORT_ARGUMENT) {
    return null
  }
  return model.efforts.find(
    (level) => normalize(level) === wanted || normalize(effortLabel(level)) === wanted
  )
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
