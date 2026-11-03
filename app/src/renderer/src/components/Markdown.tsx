import { memo, type ClipboardEvent } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

const REMARK_PLUGINS = [remarkGfm]
/** Вывод команд — обычный текст с переносами строк, а не абзацы Markdown. */
const LINE_BREAK_PLUGINS = [remarkGfm, remarkBreaks]

/** Ссылки открываются в браузере: окно Atox само по ссылкам не переходит. */
const COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />
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
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
