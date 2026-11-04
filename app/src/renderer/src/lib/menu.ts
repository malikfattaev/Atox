import type { ReactNode } from 'react'

/** Пункт всплывающего меню; `Action` — что вернёт меню, когда пункт выбран. */
export type MenuItem<Action extends string> =
  | {
      type?: 'action'
      action: Action
      label: string
      /** Значок слева от подписи, например `<Pencil />` из lucide. */
      icon?: ReactNode
      /** Цвет в формате CSS — вместо значка у пункта цветной кружок. */
      swatch?: string
      /** Пункт отмечен галочкой, например текущий выбор. */
      checked?: boolean
      /** Сочетание клавиш в формате accelerator, которое показывается справа (само меню его не перехватывает). */
      accelerator?: string
      /** `false` — пункт виден, но выбрать его нельзя, например пояснение «Loading…». */
      enabled?: boolean
      /** Необратимое действие вроде удаления: пункт красный. */
      destructive?: boolean
    }
  | {
      type: 'submenu'
      label: string
      icon?: ReactNode
      items: MenuItem<Action>[]
    }
  | { type: 'separator' }

/**
 * Где открыть меню: под элементом (кнопка, заголовок) или в точке — у курсора, как контекстное
 * меню. Подходит само событие мыши.
 */
export type MenuAnchor = Element | { clientX: number; clientY: number }

/** Открытое меню; новое меню закрывает предыдущее. */
export interface OpenMenu {
  id: number
  items: MenuItem<string>[]
  anchor: MenuAnchor
  /** Закрывает меню с выбранным действием; `null` — ничего не выбрано. */
  close(action: string | null): void
}

let current: OpenMenu | null = null
let nextId = 0
const listeners = new Set<() => void>()

function publish(menu: OpenMenu | null): void {
  current = menu
  listeners.forEach((listener) => listener())
}

export function subscribeToMenu(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getOpenMenu(): OpenMenu | null {
  return current
}

/**
 * Открывает меню и ждёт выбора: промис вернёт действие пункта или `null`, если меню закрыли.
 * Повторный вызов с тем же элементом, пока его меню открыто, закрывает меню, как у кнопки-переключателя.
 */
export function showMenu<Action extends string>(
  items: MenuItem<Action>[],
  anchor: MenuAnchor
): Promise<Action | null> {
  const previous = current
  previous?.close(null)
  if (previous && anchor instanceof Element && previous.anchor === anchor) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const menu: OpenMenu = {
      id: ++nextId,
      items,
      anchor,
      close: (action) => {
        if (current === menu) {
          publish(null)
        }
        // Действия меню — всегда из его же пунктов, поэтому сужение типа безопасно.
        resolve(action as Action | null)
      }
    }
    publish(menu)
  })
}
