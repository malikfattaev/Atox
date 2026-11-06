import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from 'react'
import { createPortal } from 'react-dom'
import { Folder, Search, type LucideIcon } from 'lucide-react'
import {
  isProjectIcon,
  PROJECT_ICON_GROUPS,
  PROJECT_ICONS,
  type ProjectIcon
} from '../../../shared/projectIcons'
import { placeAt, scrollMovesAnchor } from '../lib/popover'
import { projectIconComponent } from '../lib/projectIcons'

/** Значков в ряду сетки. */
const COLUMNS = 8

/** Значок в сетке; `icon: null` — обычная папка. */
interface Choice {
  icon: ProjectIcon | null
  name: string
  glyph: LucideIcon
  /** Текст для поиска: название, дополнительные слова и группа. */
  search: string
}

interface Group {
  id: string
  name: string
  choices: Choice[]
}

/** Группа на экране: `start` — номер её первого значка в общем списке видимых. */
interface VisibleGroup extends Group {
  start: number
}

/** Обычная папка — первой в первой группе: так её легко вернуть. */
const DEFAULT_CHOICE: Choice = {
  icon: null,
  name: 'Default',
  glyph: Folder,
  search: 'default folder none reset'
}

const GROUPS: Group[] = PROJECT_ICON_GROUPS.map((group, index) => ({
  id: group.id,
  name: group.name,
  choices: [
    ...(index === 0 ? [DEFAULT_CHOICE] : []),
    ...PROJECT_ICONS.filter((icon) => icon.group === group.id).map((icon) => ({
      icon: icon.id,
      name: icon.name,
      glyph: projectIconComponent(icon.id) ?? Folder,
      search: `${icon.name} ${icon.keywords} ${group.name}`.toLowerCase()
    }))
  ]
}))

/** Группы со значками, в которых есть все слова запроса; пустые группы скрыты. */
function visibleGroups(query: string): VisibleGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  let start = 0
  return GROUPS.flatMap((group) => {
    const choices = group.choices.filter(({ search }) =>
      words.every((word) => search.includes(word))
    )
    if (choices.length === 0) {
      return []
    }
    const visible = { ...group, choices, start }
    start += choices.length
    return [visible]
  })
}

/** Ряды сетки как номера значков: каждая группа начинается с нового ряда. */
function gridRows(groups: VisibleGroup[]): number[][] {
  return groups.flatMap(({ choices, start }) =>
    Array.from({ length: Math.ceil(choices.length / COLUMNS) }, (_, row) =>
      Array.from(
        { length: Math.min(COLUMNS, choices.length - row * COLUMNS) },
        (_, column) => start + row * COLUMNS + column
      )
    )
  )
}

/** Стрелки ходят по сетке: вверх и вниз — в соседний ряд, в ту же колонку или ближнюю к ней. */
function moveInGrid(rows: number[][], from: number, key: string): number {
  const last = rows.at(-1)?.at(-1) ?? from
  const row = rows.findIndex((cells) => cells.includes(from))
  const column = rows[row]?.indexOf(from) ?? 0
  const verticalTarget = (cells: number[] | undefined) =>
    cells ? cells[Math.min(column, cells.length - 1)]! : from
  switch (key) {
    case 'ArrowLeft':
      return Math.max(from - 1, 0)
    case 'ArrowRight':
      return Math.min(from + 1, last)
    case 'ArrowUp':
      return verticalTarget(rows[row - 1])
    case 'ArrowDown':
      return verticalTarget(rows[row + 1])
    default:
      return from
  }
}

interface IconPickerProps {
  /** Строка проекта: выбор открывается под ней. */
  anchor: Element
  /** Текущий значок проекта; нет или неизвестный — обычная папка. */
  selected: ProjectIcon | undefined
  /** Цвет проекта в CSS: значки в выборе показаны в нём; нет — обычного цвета. */
  color: string | undefined
  /** Выбран значок; `null` — обычная папка. */
  onPick(icon: ProjectIcon | null): void
  /** Выбор закрылся и доиграл анимацию: его можно убрать. */
  onClose(): void
}

/** Выбор значка папки проекта: поиск и сетка значков по группам, в стиле меню приложения. */
export function IconPicker({ anchor, selected, color, onPick, onClose }: IconPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<Element | null>(document.activeElement)
  const listId = useId()
  const current = isProjectIcon(selected) ? selected : null
  const [query, setQuery] = useState('')
  const groups = useMemo(() => visibleGroups(query), [query])
  const rows = useMemo(() => gridRows(groups), [groups])
  const choices = useMemo(() => groups.flatMap((group) => group.choices), [groups])
  // Подсвечен номер значка в списке видимых; сначала — текущий значок проекта.
  const [highlighted, setHighlighted] = useState(() =>
    Math.max(0, choices.findIndex(({ icon }) => icon === current))
  )
  // Сдвиг с клавиатуры (и сам открытый выбор) прокручивает к значку, мышь — только подсвечивает.
  const [keyboardMoved, setKeyboardMoved] = useState(true)
  const [leaving, setLeaving] = useState(false)

  const close = useCallback(
    (icon?: ProjectIcon | null) => {
      // Фокус возвращается туда, где был до выбора, если его не забрал другой элемент.
      const active = document.activeElement
      if (!active || active === document.body || panelRef.current?.contains(active)) {
        const target = restoreFocusRef.current
        if (target instanceof HTMLElement && target.isConnected) {
          target.focus({ preventScroll: true })
        }
      }
      setLeaving(true)
      if (icon !== undefined) {
        onPick(icon)
      }
    },
    [onPick]
  )

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) {
      return
    }
    const placement = placeAt(panel, anchor)
    panel.style.left = `${placement.left}px`
    panel.style.top = `${placement.top}px`
    panel.style.maxHeight = `${placement.maxHeight}px`
    inputRef.current?.focus({ preventScroll: true })
  }, [anchor])

  useLayoutEffect(() => {
    if (keyboardMoved) {
      panelRef.current
        ?.querySelector(`[data-index="${highlighted}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted, keyboardMoved])

  // Как и меню, выбор закрывают клик мимо, потеря фокуса окном, изменение размера
  // и прокрутка под якорем.
  useEffect(() => {
    if (leaving) {
      return
    }
    const isInside = (target: EventTarget | null) =>
      target instanceof Node && Boolean(panelRef.current?.contains(target))
    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) {
        close()
      }
    }
    const onScroll = (event: Event) => {
      if (scrollMovesAnchor(event, anchor)) {
        close()
      }
    }
    const onDismiss = () => close()
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
  }, [leaving, close, anchor])

  // Закрытый выбор убирается, когда доиграет анимация исчезновения (или сразу, если её нет).
  useEffect(() => {
    if (!leaving) {
      return
    }
    const animations = panelRef.current?.getAnimations({ subtree: true }) ?? []
    let cancelled = false
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) {
        onClose()
      }
    })
    return () => {
      cancelled = true
    }
  }, [leaving, onClose])

  const onKeyDown = (event: KeyboardEvent) => {
    const handled = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        // Пока в поиске есть текст, стрелки вбок двигают курсор в нём, а не по сетке.
        if (query && event.target === inputRef.current) {
          return
        }
        handled()
        setKeyboardMoved(true)
        setHighlighted((index) => moveInGrid(rows, index, event.key))
        return
      case 'ArrowUp':
      case 'ArrowDown':
        handled()
        setKeyboardMoved(true)
        setHighlighted((index) => moveInGrid(rows, index, event.key))
        return
      case 'Enter': {
        handled()
        const choice = choices[highlighted]
        if (choice) {
          close(choice.icon)
        }
        return
      }
      case 'Escape':
        handled()
        // Escape сначала очищает поиск и только потом закрывает выбор.
        if (query) {
          setQuery('')
          setHighlighted(0)
        } else {
          close()
        }
        return
      case 'Tab':
        handled()
        close()
        return
    }
  }

  const style = {
    '--icon-picker-columns': COLUMNS,
    ...(color && { '--project-color': color })
  } as CSSProperties
  const highlightedId = choices[highlighted] ? `${listId}-${highlighted}` : undefined

  return createPortal(
    <div
      className="menu-layer"
      data-state={leaving ? 'closed' : 'open'}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={panelRef}
        className="menu icon-picker"
        role="dialog"
        aria-label="Project icon"
        tabIndex={-1}
        data-colored={Boolean(color)}
        style={style}
        onKeyDown={leaving ? undefined : onKeyDown}
      >
        <label className="icon-picker__search">
          <Search className="icon-picker__search-icon" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            placeholder="Search icons"
            role="combobox"
            aria-label="Search icons"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={highlightedId}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlighted(0)
              setKeyboardMoved(true)
            }}
          />
        </label>
        <div className="menu__separator" role="separator" />
        <div id={listId} className="icon-picker__groups" role="listbox" aria-label="Icons">
          {groups.map((group) => (
            <div
              key={group.id}
              className="icon-picker__group"
              role="group"
              aria-labelledby={`${listId}-${group.id}`}
            >
              <div id={`${listId}-${group.id}`} className="icon-picker__heading">
                {group.name}
              </div>
              <div className="icon-picker__grid">
                {group.choices.map((choice, offset) => {
                  const index = group.start + offset
                  const Glyph = choice.glyph
                  return (
                    <div
                      key={choice.icon ?? DEFAULT_CHOICE.name}
                      id={`${listId}-${index}`}
                      className="icon-picker__option"
                      role="option"
                      aria-label={choice.name}
                      aria-selected={choice.icon === current}
                      title={choice.name}
                      data-index={index}
                      data-highlighted={index === highlighted}
                      // Клик по значку не уводит фокус из поиска.
                      onMouseDown={(event) => event.preventDefault()}
                      onPointerMove={() => {
                        setKeyboardMoved(false)
                        setHighlighted(index)
                      }}
                      onClick={() => close(choice.icon)}
                    >
                      <Glyph
                        className={choice.icon === null ? 'icon project-icon--folder' : 'icon'}
                        aria-hidden
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {groups.length === 0 && <p className="icon-picker__empty">No icons</p>}
        </div>
      </div>
    </div>,
    document.body
  )
}
