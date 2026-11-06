import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight } from 'lucide-react'
import { formatAccelerator } from '../../../shared/shortcuts'
import {
  getOpenMenu,
  subscribeToMenu,
  type MenuAnchor,
  type MenuItem,
  type OpenMenu
} from '../lib/menu'
import {
  anchorElement,
  placeAt,
  scrollMovesAnchor,
  VIEWPORT_MARGIN,
  type Placement
} from '../lib/popover'

/** Зазор между меню и его подменю. */
const SUBMENU_GAP = 4
/** Задержка, с которой подменю открывается под мышью: курсор, проходящий мимо, его не дёргает. */
const SUBMENU_HOVER_DELAY = 120
/**
 * Сколько ждать, пока курсор по диагонали идёт к открытому подменю через соседние пункты:
 * подменю не закрывается, если курсор движется в его сторону.
 */
const SUBMENU_AIM_DELAY = 300
/** Пауза, после которой набранные буквы начинают поиск пункта заново. */
const TYPEAHEAD_RESET = 600

/** Слой всплывающих меню: одно меню на всё окно, открывается через `showMenu`. */
export function MenuLayer() {
  const menu = useSyncExternalStore(subscribeToMenu, getOpenMenu)
  // Закрытое меню ещё доигрывает анимацию исчезновения.
  const [rendered, setRendered] = useState<OpenMenu | null>(menu)
  if (menu && menu !== rendered) {
    setRendered(menu)
  }
  const onExited = useCallback(() => setRendered(null), [])

  if (!rendered) {
    return null
  }
  return createPortal(
    <MenuRoot key={rendered.id} menu={rendered} leaving={menu !== rendered} onExited={onExited} />,
    document.body
  )
}

interface MenuRootProps {
  menu: OpenMenu
  leaving: boolean
  onExited(): void
}

type ActionItem = Extract<MenuItem<string>, { action: string }>
type SubmenuItem = Extract<MenuItem<string>, { type: 'submenu' }>

/**
 * Состояние меню с подменю: `open` — цепочка открытых подменю (индекс пункта на каждом уровне),
 * `highlighted` — подсвеченный пункт каждого уровня, `level` — уровень, где работает клавиатура.
 */
interface Navigation {
  open: number[]
  highlighted: (number | null)[]
  level: number
}

const INITIAL_NAVIGATION: Navigation = { open: [], highlighted: [null], level: 0 }

function MenuRoot({ menu, leaving, onExited }: MenuRootProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<Element | null>(document.activeElement)
  const [navigation, setNavigation] = useState<Navigation>(INITIAL_NAVIGATION)
  const hoverTimerRef = useRef<number | undefined>(undefined)
  const pointerRef = useRef<Point | null>(null)
  const typeaheadRef = useRef({ text: '', at: 0 })
  // Действие с клавиатуры подсвечивает пункт и прокручивает к нему, мышь — только подсвечивает.
  const [keyboardMoved, setKeyboardMoved] = useState(false)

  const levels = menuLevels(menu.items, navigation.open)

  const finish = useCallback(
    (action: string | null) => {
      // Фокус возвращается туда, где был до меню, если его не забрал другой элемент.
      const active = document.activeElement
      if (!active || active === document.body || rootRef.current?.contains(active)) {
        const target = restoreFocusRef.current
        if (target instanceof HTMLElement && target.isConnected) {
          target.focus({ preventScroll: true })
        }
      }
      menu.close(action)
    },
    [menu]
  )

  // Клик мимо меню, потеря фокуса окном, изменение размера и прокрутка под якорем закрывают меню.
  useEffect(() => {
    if (leaving) {
      return
    }
    const isInside = (target: EventTarget | null) =>
      target instanceof Node && Boolean(rootRef.current?.contains(target))
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (isInside(event.target)) {
        return
      }
      // По кнопке, открывшей меню, его закроет её же клик.
      if (menu.anchor instanceof Element && event.target instanceof Node) {
        if (menu.anchor.contains(event.target)) {
          return
        }
      }
      finish(null)
    }
    const anchor = anchorElement(menu.anchor)
    const onScroll = (event: Event) => {
      // Длинное меню прокручивается само — это его не закрывает.
      if (!isInside(event.target) && scrollMovesAnchor(event, anchor)) {
        finish(null)
      }
    }
    const onDismiss = () => finish(null)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onDismiss)
    window.addEventListener('resize', onDismiss)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onDismiss)
      window.removeEventListener('resize', onDismiss)
    }
  }, [menu, leaving, finish])

  // Исчезнув, меню убирается из DOM, когда доиграет анимация (или сразу, если анимаций нет).
  useEffect(() => {
    if (!leaving) {
      return
    }
    const animations = rootRef.current?.getAnimations({ subtree: true }) ?? []
    let cancelled = false
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) {
        onExited()
      }
    })
    return () => {
      cancelled = true
    }
  }, [leaving, onExited])

  useEffect(() => () => window.clearTimeout(hoverTimerRef.current), [])

  // Клавиатура работает в одном уровне: туда же переходит фокус.
  useLayoutEffect(() => {
    if (leaving) {
      return
    }
    const panel = rootRef.current?.querySelector<HTMLElement>(
      `[data-menu-level="${navigation.level}"]`
    )
    panel?.focus({ preventScroll: true })
  }, [navigation.level, levels.length, leaving])

  const highlight = (level: number, index: number | null, fromKeyboard: boolean) => {
    setKeyboardMoved(fromKeyboard)
    setNavigation((current) => {
      const highlighted = current.highlighted.slice(0, level + 1)
      highlighted[level] = index
      // Подсвеченный пункт с открытым подменю оставляет его открытым, другой — закрывает.
      const keepsSubmenu = current.open[level] === index
      const open = keepsSubmenu ? current.open : current.open.slice(0, level)
      if (keepsSubmenu) {
        highlighted.push(...current.highlighted.slice(level + 1))
      }
      return { open, highlighted, level }
    })
  }

  const openSubmenu = (level: number, index: number, focus: boolean) => {
    const submenu = levels[level]?.[index]
    if (submenu?.type !== 'submenu') {
      return
    }
    setKeyboardMoved(focus)
    setNavigation((current) => {
      const open = [...current.open.slice(0, level), index]
      const highlighted = current.highlighted.slice(0, level + 1)
      highlighted[level] = index
      highlighted[level + 1] = focus ? firstEnabled(submenu.items) : null
      return { open, highlighted, level: focus ? level + 1 : level }
    })
  }

  const closeSubmenu = (level: number) => {
    setKeyboardMoved(true)
    setNavigation((current) => ({
      open: current.open.slice(0, level - 1),
      highlighted: current.highlighted.slice(0, level),
      level: level - 1
    }))
  }

  const activate = (level: number, index: number, fromKeyboard: boolean) => {
    const item = levels[level]?.[index]
    if (!item || item.type === 'separator') {
      return
    }
    if (item.type === 'submenu') {
      openSubmenu(level, index, fromKeyboard)
    } else if (item.enabled !== false) {
      finish(item.action)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const { level } = navigation
    const items = levels[level] ?? []
    const current = navigation.highlighted[level] ?? null
    const handled = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    switch (event.key) {
      case 'ArrowDown':
        handled()
        highlight(level, stepEnabled(items, current, 1), true)
        return
      case 'ArrowUp':
        handled()
        highlight(level, stepEnabled(items, current, -1), true)
        return
      case 'Home':
      case 'PageUp':
        handled()
        highlight(level, firstEnabled(items), true)
        return
      case 'End':
      case 'PageDown':
        handled()
        highlight(level, lastEnabled(items), true)
        return
      case 'ArrowRight':
        handled()
        if (current !== null) {
          openSubmenu(level, current, true)
        }
        return
      case 'ArrowLeft':
        handled()
        if (level > 0) {
          closeSubmenu(level)
        }
        return
      case 'Enter':
      case ' ':
        handled()
        if (current !== null) {
          activate(level, current, true)
        }
        return
      case 'Escape':
      case 'Tab':
        handled()
        finish(null)
        return
    }
    // Набранные буквы подсвечивают пункт, подпись которого с них начинается.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      handled()
      const now = event.timeStamp
      const typeahead = typeaheadRef.current
      typeahead.text =
        now - typeahead.at > TYPEAHEAD_RESET ? event.key : typeahead.text + event.key
      typeahead.at = now
      const match = findByPrefix(items, typeahead.text, current)
      if (match !== null) {
        highlight(level, match, true)
      }
    }
  }

  /** Курсор над пунктом: подсветить, а подменю — открыть с небольшой задержкой. */
  const onItemPointerMove = (level: number, index: number, event: PointerEvent) => {
    const previous = pointerRef.current
    pointerRef.current = { x: event.clientX, y: event.clientY }
    if (navigation.highlighted[level] === index && navigation.level === level) {
      return
    }
    window.clearTimeout(hoverTimerRef.current)
    const apply = () => {
      highlight(level, index, false)
      if (levels[level]?.[index]?.type === 'submenu') {
        hoverTimerRef.current = window.setTimeout(
          () => openSubmenu(level, index, false),
          SUBMENU_HOVER_DELAY
        )
      }
    }
    // Курсор по пути к открытому подменю задевает соседние пункты — подменю не закрываем.
    const submenuPanel = rootRef.current?.querySelector(`[data-menu-level="${level + 1}"]`)
    if (
      navigation.open[level] !== undefined &&
      navigation.open[level] !== index &&
      previous &&
      submenuPanel &&
      isAimingAt(previous, pointerRef.current, submenuPanel.getBoundingClientRect())
    ) {
      hoverTimerRef.current = window.setTimeout(apply, SUBMENU_AIM_DELAY)
      return
    }
    apply()
  }

  /** Курсор ушёл с пунктов уровня: подсветка гаснет, кроме пункта с открытым подменю. */
  const onPanelPointerLeave = (level: number) => {
    window.clearTimeout(hoverTimerRef.current)
    if (navigation.open[level] === undefined) {
      setNavigation((current) => {
        const highlighted = [...current.highlighted]
        highlighted[level] = null
        return { ...current, highlighted }
      })
    }
  }

  return (
    <div
      ref={rootRef}
      className="menu-layer"
      data-state={leaving ? 'closed' : 'open'}
      onKeyDown={leaving ? undefined : onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {levels.map((items, level) => (
        <MenuPanel
          // Новое подменю — новая панель: она заново встаёт рядом со своим пунктом.
          key={`${level}:${navigation.open.slice(0, level).join('.')}`}
          level={level}
          items={items}
          anchor={menu.anchor}
          highlighted={navigation.highlighted[level] ?? null}
          openIndex={navigation.open[level] ?? null}
          scrollToHighlight={keyboardMoved && navigation.level === level}
          onItemPointerMove={onItemPointerMove}
          onItemClick={(index) => activate(level, index, false)}
          onPointerLeave={() => onPanelPointerLeave(level)}
        />
      ))}
    </div>
  )
}

interface MenuPanelProps {
  level: number
  items: MenuItem<string>[]
  anchor: MenuAnchor
  highlighted: number | null
  openIndex: number | null
  scrollToHighlight: boolean
  onItemPointerMove(level: number, index: number, event: PointerEvent): void
  onItemClick(index: number): void
  onPointerLeave(): void
}

function MenuPanel({
  level,
  items,
  anchor,
  highlighted,
  openIndex,
  scrollToHighlight,
  onItemPointerMove,
  onItemClick,
  onPointerLeave
}: MenuPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  // Колонки значков и галочек есть, только если они нужны хоть одному пункту: подписи выровнены.
  const hasLeading = items.some((item) => item.type !== 'separator' && hasLeadingVisual(item))
  const hasCheck = items.some((item) => item.type !== 'submenu' && 'checked' in item)

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) {
      return
    }
    const parentItem =
      level === 0
        ? null
        : panel.parentElement?.querySelector(
            `[data-menu-level="${level - 1}"] [data-menu-open="true"]`
          )
    const placement = parentItem
      ? placeBeside(panel, parentItem.getBoundingClientRect())
      : placeAt(panel, anchor)
    panel.style.left = `${placement.left}px`
    panel.style.top = `${placement.top}px`
    panel.style.maxHeight = `${placement.maxHeight}px`
  }, [anchor, level])

  useLayoutEffect(() => {
    if (scrollToHighlight && highlighted !== null) {
      panelRef.current
        ?.querySelector(`[data-menu-index="${highlighted}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted, scrollToHighlight])

  return (
    <div
      ref={panelRef}
      className="menu"
      role="menu"
      aria-orientation="vertical"
      tabIndex={-1}
      data-menu-level={level}
      onPointerLeave={onPointerLeave}
    >
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={index} className="menu__separator" role="separator" />
        }
        const isSubmenu = item.type === 'submenu'
        const disabled = !isSubmenu && item.enabled === false
        const checkable = !isSubmenu && item.checked !== undefined
        return (
          <div
            key={index}
            className="menu__item"
            role={checkable ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={checkable ? item.checked : undefined}
            aria-disabled={disabled || undefined}
            aria-haspopup={isSubmenu ? 'menu' : undefined}
            aria-expanded={isSubmenu ? openIndex === index : undefined}
            data-menu-index={index}
            data-menu-open={isSubmenu && openIndex === index}
            data-highlighted={highlighted === index && !disabled}
            data-destructive={!isSubmenu && item.destructive ? true : undefined}
            onPointerMove={(event) => !disabled && onItemPointerMove(level, index, event)}
            onClick={() => !disabled && onItemClick(index)}
          >
            {hasLeading && <LeadingVisual item={item} />}
            <span className="menu__label">{item.label}</span>
            {!isSubmenu && item.accelerator && (
              <span className="menu__accelerator">{formatAccelerator(item.accelerator)}</span>
            )}
            {isSubmenu && <ChevronRight className="menu__chevron" aria-hidden />}
            {hasCheck && (
              <span className="menu__check" aria-hidden>
                {!isSubmenu && item.checked && <Check />}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function hasLeadingVisual(item: ActionItem | SubmenuItem): boolean {
  return Boolean(item.icon) || (item.type !== 'submenu' && Boolean(item.swatch))
}

function LeadingVisual({ item }: { item: ActionItem | SubmenuItem }) {
  if (item.type !== 'submenu' && item.swatch) {
    return (
      <span className="menu__icon" aria-hidden>
        <span className="menu__swatch" style={{ background: item.swatch }} />
      </span>
    )
  }
  return (
    <span className="menu__icon" aria-hidden>
      {item.icon}
    </span>
  )
}

/** Пункты каждого открытого уровня: корень и цепочка подменю. */
function menuLevels(items: MenuItem<string>[], open: number[]): MenuItem<string>[][] {
  const levels = [items]
  for (const index of open) {
    const item = levels[levels.length - 1]?.[index]
    if (item?.type !== 'submenu') {
      break
    }
    levels.push(item.items)
  }
  return levels
}

const isEnabled = (item: MenuItem<string> | undefined): boolean =>
  item !== undefined &&
  item.type !== 'separator' &&
  (item.type === 'submenu' || item.enabled !== false)

function firstEnabled(items: MenuItem<string>[]): number | null {
  const index = items.findIndex(isEnabled)
  return index === -1 ? null : index
}

function lastEnabled(items: MenuItem<string>[]): number | null {
  const index = items.findLastIndex(isEnabled)
  return index === -1 ? null : index
}

/** Следующий доступный пункт в направлении `step` по кругу. */
function stepEnabled(items: MenuItem<string>[], from: number | null, step: 1 | -1): number | null {
  if (from === null) {
    return step === 1 ? firstEnabled(items) : lastEnabled(items)
  }
  for (let offset = 1; offset <= items.length; offset++) {
    const index = (from + step * offset + items.length) % items.length
    if (isEnabled(items[index])) {
      return index
    }
  }
  return from
}

/** Пункт, подпись которого начинается с набранного; поиск идёт после текущего, по кругу. */
function findByPrefix(items: MenuItem<string>[], text: string, from: number | null): number | null {
  const wanted = text.toLowerCase()
  const start = from === null ? 0 : from + (text.length === 1 ? 1 : 0)
  for (let offset = 0; offset < items.length; offset++) {
    const index = (start + offset) % items.length
    const item = items[index]
    const label = item && item.type !== 'separator' ? item.label.toLowerCase() : ''
    if (isEnabled(item) && label.startsWith(wanted)) {
      return index
    }
  }
  return null
}

/**
 * Идёт ли курсор к подменю: новая точка внутри треугольника между прежней точкой и ближним
 * к меню краем подменю.
 */
function isAimingAt(from: Point, to: Point, target: DOMRect): boolean {
  const edgeX = target.left >= from.x ? target.left : target.right
  const a = { x: edgeX, y: target.top }
  const b = { x: edgeX, y: target.bottom }
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = side(from, a, to)
  const d2 = side(a, b, to)
  const d3 = side(b, from, to)
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNegative && hasPositive)
}

interface Point {
  x: number
  y: number
}

/** Подменю: справа от своего пункта, первый пункт вровень с ним; у края окна — слева. */
function placeBeside(panel: HTMLElement, item: DOMRect): Placement {
  const { innerWidth, innerHeight } = window
  const parentPanel = panel.parentElement
    ?.querySelector(`[data-menu-level="${Number(panel.dataset['menuLevel']) - 1}"]`)
    ?.getBoundingClientRect()
  const parentLeft = parentPanel?.left ?? item.left
  const parentRight = parentPanel?.right ?? item.right
  const maxHeight = innerHeight - VIEWPORT_MARGIN * 2
  const width = panel.offsetWidth
  const height = Math.min(panel.scrollHeight, maxHeight)
  const paddingTop = parseFloat(getComputedStyle(panel).paddingTop) || 0

  const fitsRight = parentRight + SUBMENU_GAP + width <= innerWidth - VIEWPORT_MARGIN
  const left = fitsRight
    ? parentRight + SUBMENU_GAP
    : Math.max(VIEWPORT_MARGIN, parentLeft - SUBMENU_GAP - width)
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(item.top - paddingTop, innerHeight - VIEWPORT_MARGIN - height)
  )
  return { left, top, maxHeight }
}
