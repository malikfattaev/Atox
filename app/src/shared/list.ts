/**
 * Возвращает копию списка, где элемент с позиции `fromIndex` перенесён на `toIndex`,
 * или `null`, если переносить нечего. Целевая позиция приводится к границам списка.
 */
export function moveItem<Item>(
  items: readonly Item[],
  fromIndex: number,
  toIndex: number
): Item[] | null {
  const target = Math.min(Math.max(toIndex, 0), items.length - 1)
  if (fromIndex < 0 || fromIndex >= items.length || fromIndex === target) {
    return null
  }
  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  next.splice(target, 0, item)
  return next
}

/**
 * Переносит элемент на позицию `toIndex` среди элементов той же группы (например, проектов
 * одного пространства); элементы других групп остаются на своих местах.
 */
export function moveItemWithinGroup<Item>(
  items: readonly Item[],
  fromIndex: number,
  toIndex: number,
  sameGroup: (a: Item, b: Item) => boolean
): Item[] | null {
  const item = items[fromIndex]
  if (item === undefined) {
    return null
  }
  const group = items.filter((other) => sameGroup(other, item))
  const target = group[Math.min(Math.max(toIndex, 0), group.length - 1)]!
  return moveItem(items, fromIndex, items.indexOf(target))
}
