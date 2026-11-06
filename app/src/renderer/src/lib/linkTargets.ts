import { createContext } from 'react'
import { EXTERNAL_LINK_PROTOCOLS } from '../../../shared/links'

/** Папка проекта чата: от неё считаются относительные пути в ссылках из ответов агента. */
export const LinkBaseDirectoryContext = createContext<string | undefined>(undefined)

/** Куда ведёт ссылка из ответа агента. */
export type LinkTarget =
  /** Сайт или почта: открывает внешнее приложение. */
  | { kind: 'external' }
  /** Файл или папка на диске: абсолютный путь или относительный от папки проекта. */
  | { kind: 'file'; path: string }
  /** Якорь, незнакомая схема или битый адрес: по клику ничего не происходит. */
  | { kind: 'none' }

const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i
/**
 * Путь к файлу со строкой (`app.ts:42`, `README.md:10:5`) по форме похож на адрес со схемой
 * `app.ts:`. У таких ссылок после двоеточия только номера строки и колонки.
 */
const PATH_WITH_LINE = /^[^:/?#]+:\d+(?::\d+)?$/
const FILE_PROTOCOL = 'file:'
/** Хвост ссылки, который к пути не относится: `?query` и `#L42`. */
const QUERY_OR_FRAGMENT = /[?#].*$/s

export function linkTarget(href: string | undefined): LinkTarget {
  // `#якорь` ведёт внутрь страницы, `//host` — на сайт без схемы: ни то ни другое не файл.
  if (!href || href.startsWith('#') || href.startsWith('//')) {
    return { kind: 'none' }
  }
  if (!URL_SCHEME.test(href) || PATH_WITH_LINE.test(href)) {
    return filePath(href.replace(QUERY_OR_FRAGMENT, ''))
  }
  if (!URL.canParse(href)) {
    return { kind: 'none' }
  }
  const url = new URL(href)
  if (EXTERNAL_LINK_PROTOCOLS.has(url.protocol)) {
    return { kind: 'external' }
  }
  return url.protocol === FILE_PROTOCOL ? filePath(url.pathname) : { kind: 'none' }
}

/** Путь из ссылки, в которой пробелы и не-ASCII закодированы, как в любом URL. */
function filePath(encoded: string): LinkTarget {
  try {
    const path = decodeURI(encoded)
    return path ? { kind: 'file', path } : { kind: 'none' }
  } catch {
    return { kind: 'none' }
  }
}
