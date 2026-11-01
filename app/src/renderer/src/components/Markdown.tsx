import { memo } from 'react'
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
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={preserveLineBreaks ? LINE_BREAK_PLUGINS : REMARK_PLUGINS}
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
