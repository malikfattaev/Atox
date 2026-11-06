/** Начало огороженного блока кода: три и больше ` или ~ с отступом до трёх пробелов. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
/** Маркер пункта списка: после пустой строки он может продолжать тот же список. */
const LIST_MARKER = /^(?:[*+-]|\d{1,9}[.)])(?:\s|$)/
/**
 * Определение ссылки или сноски (`[id]: url`, `[^1]: …`) действует на весь текст: такой текст
 * делить нельзя, иначе ссылки в других частях перестанут работать.
 */
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:/m

interface Fence {
  marker: string
  length: number
}

function closesFence(line: string, fence: Fence): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)
  return Boolean(match && match[1].startsWith(fence.marker) && match[1].length >= fence.length)
}

/**
 * Строка после пустой начинает независимый блок, только если ничего не продолжает: без отступа
 * (иначе это продолжение пункта списка или код) и не новый пункт того же списка.
 */
function startsIndependentBlock(line: string): boolean {
  return !/^\s/.test(line) && !LIST_MARKER.test(line)
}

/**
 * Делит Markdown на части верхнего уровня, которые разбираются независимо: пока агент пишет,
 * меняется только последняя часть, а готовые не разбираются заново. Блоки кода не режутся.
 */
export function splitMarkdownBlocks(text: string): string[] {
  if (REFERENCE_DEFINITION.test(text)) {
    return [text]
  }
  const blocks: string[] = []
  let current: string[] = []
  let hasContent = false
  let afterBlank = false
  let fence: Fence | null = null

  for (const line of text.split('\n')) {
    if (fence) {
      current.push(line)
      if (closesFence(line, fence)) {
        fence = null
      }
      continue
    }
    if (line.trim() === '') {
      current.push(line)
      afterBlank = true
      continue
    }
    if (afterBlank && hasContent && startsIndependentBlock(line)) {
      blocks.push(current.join('\n'))
      current = []
    }
    afterBlank = false
    hasContent = true
    current.push(line)
    const opening = FENCE_OPEN.exec(line)
    if (opening) {
      fence = { marker: opening[1][0], length: opening[1].length }
    }
  }
  blocks.push(current.join('\n'))
  return blocks
}
