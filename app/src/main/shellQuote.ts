/** Строка в одинарных кавычках для POSIX-оболочки: внутри ничего не раскрывается. */
export function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
