/** Символы, которые оболочка трактует особо: экранируем их, как Terminal.app при перетаскивании. */
const SHELL_SPECIAL_CHARACTERS = /[\s!"#$&'()*;<>?[\\\]`{|}~]/g

/** Пути через пробел, готовые к вставке в командную строку; в конце пробел, как в Terminal.app. */
export function formatPathsForShell(paths: readonly string[]): string {
  return `${paths.map((path) => path.replace(SHELL_SPECIAL_CHARACTERS, '\\$&')).join(' ')} `
}
