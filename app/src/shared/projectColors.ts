/** Цвета папок проектов — системные цвета macOS, как у меток Finder. */
export const PROJECT_COLORS = [
  { id: 'red', name: 'Red', light: '#ff3b30', dark: '#ff453a' },
  { id: 'orange', name: 'Orange', light: '#ff9500', dark: '#ff9f0a' },
  { id: 'yellow', name: 'Yellow', light: '#ffcc00', dark: '#ffd60a' },
  { id: 'green', name: 'Green', light: '#34c759', dark: '#30d158' },
  { id: 'blue', name: 'Blue', light: '#007aff', dark: '#0a84ff' },
  { id: 'purple', name: 'Purple', light: '#af52de', dark: '#bf5af2' },
  { id: 'gray', name: 'Gray', light: '#8e8e93', dark: '#98989d' }
] as const

export type ProjectColor = (typeof PROJECT_COLORS)[number]['id']

export function isProjectColor(value: unknown): value is ProjectColor {
  return PROJECT_COLORS.some(({ id }) => id === value)
}

export function findProjectColor(id: ProjectColor | undefined) {
  return PROJECT_COLORS.find((color) => color.id === id)
}
