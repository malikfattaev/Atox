import {
  memo,
  useContext,
  type AnchorHTMLAttributes,
  type ClipboardEvent,
  type MouseEvent
} from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { imageTypeOfPath } from '../../../shared/attachments'
import { ipcErrorMessage } from '../lib/ipcError'
import { LinkBaseDirectoryContext, linkTarget } from '../lib/linkTargets'
import { LocalImage } from './GeneratedImage'

const { atox } = window

const REMARK_PLUGINS = [remarkGfm]
/** Вывод команд — обычный текст с переносами строк, а не абзацы Markdown. */
const LINE_BREAK_PLUGINS = [remarkGfm, remarkBreaks]

const FILE_URL_PREFIX = 'file://'

/**
 * Путь к картинке на диске, если ссылка ведёт на неё: `/Users/…/cat.png` или
 * `file:///Users/…/cat.png`. Так агенты ссылаются на картинки, которые сохранили сами.
 */
function localImagePath(url: string | undefined): string | undefined {
  if (!url) return undefined
  const raw = url.startsWith(FILE_URL_PREFIX) ? url.slice(FILE_URL_PREFIX.length) : url
  if (!raw.startsWith('/') || raw.startsWith('//')) return undefined
  let path: string
  try {
    path = decodeURI(raw)
  } catch {
    return undefined
  }
  return imageTypeOfPath(path) ? path : undefined
}

/** `file://` оставляем как есть — это ссылка на файл, остальное чистит обычная проверка ссылок. */
function urlTransform(url: string): string {
  return url.startsWith(FILE_URL_PREFIX) ? url : defaultUrlTransform(url)
}

/**
 * Ссылка из ответа: сайт и почта открываются внешним приложением, файл проекта — программой
 * по умолчанию. Окно Atox само по ссылкам не переходит.
 */
function MarkdownLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const baseDirectory = useContext(LinkBaseDirectoryContext)
  const target = linkTarget(props.href)
  if (target.kind === 'external') {
    return <a {...props} target="_blank" rel="noreferrer" />
  }
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    if (target.kind === 'file') {
      atox.files
        .open(target.path, baseDirectory)
        .catch((error) => console.error('Failed to open the link', ipcErrorMessage(error)))
    }
  }
  return <a {...props} title={target.kind === 'file' ? target.path : props.title} onClick={open} />
}

/** Картинка на диске — и в виде `![](путь)`, и в виде ссылки на файл — видна прямо в ответе. */
const COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => {
    const link = <MarkdownLink {...props} />
    const path = localImagePath(props.href)
    return path ? <LocalImage path={path} fallback={link} /> : link
  },
  img: ({ node: _node, ...props }) => {
    const path = localImagePath(props.src)
    return path ? <LocalImage path={path} fallback={props.alt ?? null} /> : <img {...props} />
  }
}

/**
 * Выделение, задевшее блок кода, копируется обычным текстом: иначе HTML с <pre>
 * мессенджеры (Telegram и др.) вставляют как моноширинный блок кода.
 */
function copyCodeAsPlainText(event: ClipboardEvent<HTMLDivElement>): void {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return
  const touchesCode = Array.from(event.currentTarget.querySelectorAll('pre')).some((pre) =>
    selection.containsNode(pre, true)
  )
  if (!touchesCode) return
  event.preventDefault()
  event.clipboardData.setData('text/plain', selection.toString())
}

/** Ответ агента в Markdown, как в GitHub: таблицы, списки задач, зачёркивание. */
export const Markdown = memo(function Markdown({
  text,
  preserveLineBreaks = false
}: {
  text: string
  /** Каждый перенос строки — новая строка, как в выводе команд агента. */
  preserveLineBreaks?: boolean
}) {
  return (
    <div className="markdown" onCopy={copyCodeAsPlainText}>
      <ReactMarkdown
        remarkPlugins={preserveLineBreaks ? LINE_BREAK_PLUGINS : REMARK_PLUGINS}
        components={COMPONENTS}
        urlTransform={urlTransform}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
