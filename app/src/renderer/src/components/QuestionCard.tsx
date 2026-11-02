import { useState } from 'react'
import { ExternalLink, MessageCircleQuestion } from 'lucide-react'
import type {
  InputField,
  InputValue,
  QuestionStatus,
  TimelineItem
} from '../../../shared/conversation'

type QuestionItem = Extract<TimelineItem, { kind: 'question' }>

const STATUS_LABELS: Record<Exclude<QuestionStatus, 'pending' | 'answered'>, string> = {
  declined: 'Declined',
  cancelled: 'Cancelled'
}

/** Скрытый ответ — пароль или токен — в карточке после ответа. */
const SECRET_MASK = '••••••'

interface QuestionCardProps {
  chatId: string
  item: QuestionItem
}

/** Вопросы агента или форма MCP-сервера: пока пользователь не ответит, агент ждёт. */
export function QuestionCard({ chatId, item }: QuestionCardProps) {
  const [values, setValues] = useState<Record<string, InputValue>>(() => initialValues(item.fields))
  const [answered, setAnswered] = useState(false)
  const pending = item.status === 'pending'
  const complete = item.fields.every((field) => !field.required || isFilled(values[field.id]))

  const answer = (accepted: boolean) => {
    setAnswered(true)
    void window.atox.conversations.answerRequest(
      chatId,
      item.id,
      accepted ? { accepted, values } : { accepted }
    )
  }
  const setValue = (id: string, value: InputValue) =>
    setValues((current) => ({ ...current, [id]: value }))

  return (
    <form
      className="approval"
      data-status={item.status}
      onSubmit={(event) => {
        event.preventDefault()
        if (pending && complete && !answered) {
          answer(true)
        }
      }}
    >
      <div className="approval__header">
        <MessageCircleQuestion className="icon" />
        <span className="approval__title">{item.title}</span>
      </div>
      {item.description && <p className="approval__description">{item.description}</p>}
      {item.url && (
        <a className="question__link" href={item.url} target="_blank" rel="noreferrer">
          <ExternalLink className="icon" />
          <span>{item.url}</span>
        </a>
      )}
      {item.fields.map((field) =>
        pending ? (
          <FieldInput
            key={field.id}
            field={field}
            value={values[field.id]}
            disabled={answered}
            onChange={(value) => setValue(field.id, value)}
          />
        ) : (
          <div key={field.id} className="question__field">
            <span className="question__label">{field.label}</span>
            {field.description && field.description !== field.label && (
              <span className="question__description">{field.description}</span>
            )}
            <span className="question__answer">
              {formatAnswer(field, item.answers?.[field.id])}
            </span>
          </div>
        )
      )}
      <div className="approval__footer">
        {item.status === 'pending' ? (
          <>
            <button
              type="button"
              className="approval__button"
              disabled={answered}
              onClick={() => answer(false)}
            >
              {item.url ? 'Cancel' : 'Decline'}
            </button>
            <button
              type="submit"
              className="approval__button approval__button--allow"
              disabled={answered || !complete}
            >
              {item.url ? 'Done' : 'Submit'}
            </button>
          </>
        ) : (
          item.status !== 'answered' && (
            <span className="approval__status">{STATUS_LABELS[item.status]}</span>
          )
        )}
      </div>
    </form>
  )
}

interface FieldInputProps {
  field: InputField
  value: InputValue | undefined
  disabled: boolean
  onChange(value: InputValue): void
}

function FieldInput({ field, value, disabled, onChange }: FieldInputProps) {
  const header = (
    <>
      <span className="question__label">
        {field.label}
        {field.required && field.type !== 'boolean' && <span aria-hidden> *</span>}
      </span>
      {field.description && field.description !== field.label && (
        <span className="question__description">{field.description}</span>
      )}
    </>
  )
  switch (field.type) {
    case 'boolean':
      return (
        <label className="question__field question__field--inline">
          <input
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span className="question__inline-text">{header}</span>
        </label>
      )
    case 'choice':
      return (
        <fieldset className="question__field" disabled={disabled}>
          {header}
          <ChoiceInput field={field} value={value} onChange={onChange} />
        </fieldset>
      )
    case 'number':
      return (
        <label className="question__field">
          {header}
          <input
            className="question__input"
            type="number"
            step={field.integer ? 1 : 'any'}
            value={typeof value === 'number' ? value : ''}
            disabled={disabled}
            onChange={(event) =>
              onChange(event.target.value === '' ? '' : Number(event.target.value))
            }
          />
        </label>
      )
    case 'text':
      return (
        <label className="question__field">
          {header}
          <input
            className="question__input"
            type={field.secret ? 'password' : 'text'}
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      )
  }
}

interface ChoiceInputProps {
  field: InputField
  value: InputValue | undefined
  onChange(value: InputValue): void
}

/** Варианты ответа; «Other» — свой ответ, если вопрос его допускает. */
function ChoiceInput({ field, value, onChange }: ChoiceInputProps) {
  const options = field.options ?? []
  const known = new Set(options.map((option) => option.value))
  const selected = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []
  const other = selected.find((item) => !known.has(item))
  const [otherText, setOtherText] = useState(other ?? '')
  const [otherChosen, setOtherChosen] = useState(other !== undefined)

  const update = (chosen: string[]) => onChange(field.multiple ? chosen : (chosen[0] ?? ''))
  const knownSelected = selected.filter((item) => known.has(item))
  const withOther = (chosen: string[], include: boolean, text: string) =>
    include && text.trim() ? [...chosen, text.trim()] : chosen

  const toggle = (optionValue: string) => {
    if (!field.multiple) {
      setOtherChosen(false)
      update([optionValue])
      return
    }
    const next = knownSelected.includes(optionValue)
      ? knownSelected.filter((item) => item !== optionValue)
      : [...knownSelected, optionValue]
    update(withOther(next, otherChosen, otherText))
  }

  return (
    <div className="question__options">
      {options.map((option) => (
        <label key={option.value} className="question__option">
          <input
            type={field.multiple ? 'checkbox' : 'radio'}
            name={field.id}
            checked={knownSelected.includes(option.value) && (field.multiple || !otherChosen)}
            onChange={() => toggle(option.value)}
          />
          <span className="question__option-text">
            <span>{option.label}</span>
            {option.description && (
              <span className="question__description">{option.description}</span>
            )}
          </span>
        </label>
      ))}
      {field.allowOther && (
        <label className="question__option">
          <input
            type={field.multiple ? 'checkbox' : 'radio'}
            name={field.id}
            checked={otherChosen}
            onChange={(event) => {
              const include = field.multiple ? event.target.checked : true
              setOtherChosen(include)
              update(withOther(field.multiple ? knownSelected : [], include, otherText))
            }}
          />
          <input
            className="question__input"
            type="text"
            placeholder="Other"
            value={otherText}
            onFocus={() => {
              if (!otherChosen) {
                setOtherChosen(true)
                update(withOther(field.multiple ? knownSelected : [], true, otherText))
              }
            }}
            onChange={(event) => {
              setOtherText(event.target.value)
              setOtherChosen(true)
              update(withOther(field.multiple ? knownSelected : [], true, event.target.value))
            }}
          />
        </label>
      )}
    </div>
  )
}

function initialValues(fields: readonly InputField[]): Record<string, InputValue> {
  return Object.fromEntries(
    fields.flatMap((field) =>
      field.defaultValue !== undefined
        ? [[field.id, field.defaultValue]]
        : field.type === 'boolean'
          ? [[field.id, false]]
          : []
    )
  )
}

function isFilled(value: InputValue | undefined): boolean {
  if (Array.isArray(value)) {
    return value.length > 0
  }
  return value !== undefined && value !== ''
}

function formatAnswer(field: InputField, value: InputValue | undefined): string {
  if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
    return '—'
  }
  if (field.secret) {
    return SECRET_MASK
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  const labels = new Map(field.options?.map((option) => [option.value, option.label]))
  const items = Array.isArray(value) ? value : [String(value)]
  return items.map((item) => labels.get(item) ?? item).join(', ')
}
