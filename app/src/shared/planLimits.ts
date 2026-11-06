import type { AgentId } from './agents'
import type { PlanLimit } from './conversation'

/** Последние известные лимиты подписки агента. */
export interface AgentPlanLimits {
  /** Окна лимитов, самое короткое первым; пустой список — агент работает не по подписке. */
  limits: PlanLimit[]
  /** Когда лимиты узнали, мс с начала эпохи. */
  updatedAt: number
}

/** Лимиты подписки по агентам; агента нет — его лимиты ещё не известны. */
export type PlanLimitsState = Partial<Record<AgentId, AgentPlanLimits>>
