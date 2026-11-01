import { useEffect, useRef } from 'react'
import type { AgentCommand } from '../../../shared/conversation'

interface CommandMenuProps {
  commands: readonly AgentCommand[]
  activeIndex: number
  onHover(index: number): void
  onChoose(command: AgentCommand): void
}

/** Подсказки команд над полем ввода, пока набирается «/команда». */
export function CommandMenu({ commands, activeIndex, onHover, onChoose }: CommandMenuProps) {
  const listRef = useRef<HTMLUListElement>(null)

  // Выбранная стрелками команда всегда видна в списке.
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <ul ref={listRef} className="command-menu" role="listbox" aria-label="Commands">
      {commands.map((command, index) => (
        <li
          key={command.name}
          role="option"
          aria-selected={index === activeIndex}
          className="command-menu__item"
          onMouseMove={() => onHover(index)}
          // Клик не должен забирать фокус у поля ввода.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(command)}
        >
          <span className="command-menu__name">/{command.name}</span>
          {command.argumentHint && (
            <span className="command-menu__hint">{command.argumentHint}</span>
          )}
          <span className="command-menu__description">{command.description}</span>
        </li>
      ))}
    </ul>
  )
}

/** Сколько подсказок показывать: дальше набор сам сужает список. */
const COMMAND_SUGGESTION_LIMIT = 50

/**
 * Команды, подходящие к набранному: сначала точное совпадение (Enter выполнит именно её),
 * потом начинающиеся с набранного, потом содержащие его.
 */
export function filterCommands(commands: readonly AgentCommand[], query: string): AgentCommand[] {
  const wanted = query.toLowerCase()
  const rank = (name: string) => {
    const lower = name.toLowerCase()
    if (lower === wanted) {
      return 0
    }
    if (lower.startsWith(wanted)) {
      return 1
    }
    return lower.includes(wanted) ? 2 : -1
  }
  return commands
    .map((command) => ({ command, rank: rank(command.name) }))
    .filter(({ rank }) => rank >= 0)
    // Сортировка устойчивая: внутри одного ранга остаётся порядок агента.
    .sort((a, b) => a.rank - b.rank)
    .slice(0, COMMAND_SUGGESTION_LIMIT)
    .map(({ command }) => command)
}
