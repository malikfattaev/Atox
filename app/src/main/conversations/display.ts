import { isAbsolute, relative, sep } from 'node:path'

/** Путь для ленты: внутри папки проекта — относительный, снаружи — как есть. */
export function displayPath(path: string, cwd: string): string {
  if (!isAbsolute(path)) {
    return path
  }
  const inside = relative(cwd, path)
  return inside && !inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside)
    ? inside
    : path
}

/** Текст ошибки для ленты: у процессов агентов это обычно Error, но бывает что угодно. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
