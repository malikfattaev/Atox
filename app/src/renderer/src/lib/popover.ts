import type { MenuAnchor } from './menu'

/** Отступ всплывающей панели от краёв окна. */
export const VIEWPORT_MARGIN = 8
/** Зазор между кнопкой и панелью, которая открывается под ней. */
const ANCHOR_GAP = 4

/** Где встать всплывающей панели и сколько у неё места по высоте. */
export interface Placement {
  left: number
  top: number
  maxHeight: number
}

/**
 * Всплывающая панель (меню, выбор значка): под элементом (или над ним, если внизу тесно)
 * либо у курсора.
 */
export function placeAt(panel: HTMLElement, anchor: MenuAnchor): Placement {
  const { innerWidth, innerHeight } = window
  const maxHeight = innerHeight - VIEWPORT_MARGIN * 2
  const width = panel.offsetWidth
  const height = Math.min(panel.scrollHeight, maxHeight)
  const clampLeft = (left: number) =>
    Math.max(VIEWPORT_MARGIN, Math.min(left, innerWidth - VIEWPORT_MARGIN - width))

  if (anchor instanceof Element) {
    const rect = anchor.getBoundingClientRect()
    const below = innerHeight - VIEWPORT_MARGIN - rect.bottom - ANCHOR_GAP
    const above = rect.top - VIEWPORT_MARGIN - ANCHOR_GAP
    const left = clampLeft(rect.left)
    if (height <= below || below >= above) {
      return { left, top: rect.bottom + ANCHOR_GAP, maxHeight: below }
    }
    const fitted = Math.min(height, above)
    return { left, top: rect.top - ANCHOR_GAP - fitted, maxHeight: above }
  }

  // У курсора панель открывается вправо-вниз, а у края окна — в обратную сторону.
  const { clientX: x, clientY: y } = anchor
  const flipX = x + width > innerWidth - VIEWPORT_MARGIN
  const flipY = y + height > innerHeight - VIEWPORT_MARGIN
  const left = clampLeft(flipX ? x - width : x)
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(flipY ? y - height : y, innerHeight - VIEWPORT_MARGIN - height)
  )
  return { left, top, maxHeight }
}

/**
 * Элемент, к которому привязана панель: кнопка или то, на чём кликнули для контекстного меню
 * (событие мыши несёт свой `target`). `null` — точка без элемента.
 */
export function anchorElement(anchor: MenuAnchor): Element | null {
  if (anchor instanceof Element) {
    return anchor
  }
  return 'target' in anchor && anchor.target instanceof Element ? anchor.target : null
}

/**
 * Сдвинула ли прокрутка якорь панели — только тогда панель оторвалась бы от него и её пора
 * закрыть. Прокрутка соседних областей (например, лента чата, которая сама едет при стриминге)
 * панель не трогает. Панель, открытая в точке без элемента под ней, сдвигается только вместе
 * со страницей.
 */
export function scrollMovesAnchor(event: Event, anchor: Element | null): boolean {
  const scrolled = event.target
  if (!(scrolled instanceof Node)) {
    return false
  }
  return anchor === null ? scrolled instanceof Document : scrolled.contains(anchor)
}
