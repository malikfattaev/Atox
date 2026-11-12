/** Учётная запись github.com, в которую выполнен вход в `gh`. */
export interface GitHubAccount {
  login: string
  /** Активная учётная запись `gh`: под ней по умолчанию работают `gh` и git. */
  active: boolean
}

/** Хост GitHub, учётные записи которого показывает и использует Atox. */
export const GITHUB_HOST = 'github.com'
