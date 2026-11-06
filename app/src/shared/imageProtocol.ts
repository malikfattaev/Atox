/**
 * Схема, по которой окно берёт картинки с диска. Так картинки не хранятся в памяти окна
 * строками base64: их кэширует и выгружает сам Chromium, как обычные картинки сайта.
 */
export const IMAGE_PROTOCOL = 'atox-image'

/** Стандартной схеме нужен хост; путь к файлу лежит в параметре, чтобы его не нормализовали. */
const IMAGE_HOST = 'local'
const PATH_PARAMETER = 'path'

/** Адрес картинки с диска для `<img src>`. */
export function imageUrl(path: string): string {
  const query = new URLSearchParams({ [PATH_PARAMETER]: path })
  return `${IMAGE_PROTOCOL}://${IMAGE_HOST}/?${query}`
}

/** Путь к файлу из адреса картинки; `null` — адрес не наш. */
export function imagePathOfUrl(url: string): string | null {
  if (!URL.canParse(url)) {
    return null
  }
  const parsed = new URL(url)
  return parsed.protocol === `${IMAGE_PROTOCOL}:` && parsed.host === IMAGE_HOST
    ? parsed.searchParams.get(PATH_PARAMETER)
    : null
}
