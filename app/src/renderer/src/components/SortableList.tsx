import { useMemo, type ReactNode } from 'react'
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/** Сдвиг курсора, после которого нажатие считается перетаскиванием, а не кликом. */
const DRAG_ACTIVATION_DISTANCE_PX = 4

const MODIFIERS = [restrictToVerticalAxis]

interface SortableListProps<Item extends { id: string }> {
  items: readonly Item[]
  onMove(id: string, toIndex: number): void
  children(item: Item): ReactNode
}

/**
 * Список, порядок которого меняется перетаскиванием. У каждого списка свой контекст:
 * элементы переносятся только внутри него — чаты не уходят в чужой проект.
 */
export function SortableList<Item extends { id: string }>({
  items,
  onMove,
  children
}: SortableListProps<Item>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } })
  )
  const ids = useMemo(() => items.map(({ id }) => id), [items])

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      onMove(String(active.id), ids.indexOf(String(over.id)))
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={MODIFIERS}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul>{items.map(children)}</ul>
      </SortableContext>
    </DndContext>
  )
}

/**
 * Подключает элемент списка к перетаскиванию. `handleProps` вешаются на ту часть элемента,
 * за которую его можно тянуть; `disabled` — например, пока идёт переименование.
 */
export function useSortableItem(id: string, disabled = false) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id,
    disabled
  })
  return {
    itemProps: {
      ref: setNodeRef,
      style: { transform: CSS.Translate.toString(transform), transition },
      'data-dragging': isDragging
    },
    handleProps: listeners
  }
}
