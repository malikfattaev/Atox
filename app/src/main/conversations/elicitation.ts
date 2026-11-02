import type { InputField, InputOption, InputValue } from '../../shared/conversation'

/*
 * Формы MCP-серверов (`elicitation/create`): плоская JSON Schema из строк, чисел, флагов
 * и списков вариантов. Поле, которое не описать так, показывается текстовым.
 */

type Schema = Record<string, unknown>

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/** Варианты из `enum` (+ `enumNames`) или из `oneOf`/`anyOf` вида `{ const, title }`. */
function options(schema: Schema): InputOption[] | undefined {
  if (Array.isArray(schema['enum'])) {
    const names = Array.isArray(schema['enumNames']) ? schema['enumNames'] : []
    return schema['enum'].map((value, index) => ({
      value: String(value),
      label: text(names[index]) ?? String(value)
    }))
  }
  const variants = schema['oneOf'] ?? schema['anyOf']
  if (Array.isArray(variants)) {
    const parsed = variants.filter(isSchema).flatMap((variant) =>
      variant['const'] === undefined
        ? []
        : [
            {
              value: String(variant['const']),
              label: text(variant['title']) ?? String(variant['const'])
            }
          ]
    )
    return parsed.length > 0 ? parsed : undefined
  }
  return undefined
}

function defaultValue(value: unknown): InputValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  return Array.isArray(value) ? value.map(String) : undefined
}

export function elicitationFields(requestedSchema: unknown): InputField[] {
  if (!isSchema(requestedSchema) || !isSchema(requestedSchema['properties'])) {
    return []
  }
  const required = new Set(
    Array.isArray(requestedSchema['required']) ? requestedSchema['required'] : []
  )
  return Object.entries(requestedSchema['properties']).flatMap(([id, property]): InputField[] => {
    if (!isSchema(property)) {
      return []
    }
    const base = {
      id,
      label: text(property['title']) ?? id,
      ...(text(property['description']) && {
        description: text(property['description'])
      }),
      required: required.has(id),
      ...(defaultValue(property['default']) !== undefined && {
        defaultValue: defaultValue(property['default'])
      })
    }
    switch (property['type']) {
      case 'boolean':
        return [{ ...base, type: 'boolean' }]
      case 'number':
      case 'integer':
        return [
          {
            ...base,
            type: 'number',
            integer: property['type'] === 'integer'
          }
        ]
      case 'array': {
        const choices = isSchema(property['items']) ? options(property['items']) : undefined
        return [
          choices
            ? { ...base, type: 'choice', options: choices, multiple: true }
            : { ...base, type: 'text' }
        ]
      }
      default: {
        const choices = options(property)
        return [
          choices
            ? { ...base, type: 'choice', options: choices }
            : {
                ...base,
                type: 'text',
                ...(property['format'] === 'password' && { secret: true })
              }
        ]
      }
    }
  })
}

/** Ответ формы для MCP-сервера: только заполненные поля. */
export function elicitationContent(
  values: Record<string, InputValue> | undefined
): Record<string, InputValue> {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(([, value]) => value !== '' && value !== undefined)
  )
}
