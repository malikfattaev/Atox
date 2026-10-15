/**
 * Команда `atox` для агентов в терминалах Atox: запустить помощника в соседнем чате,
 * написать ему или своему агенту, отчитаться о работе. Запускается бинарником Electron
 * в режиме Node и передаёт команду приложению через его локальный сокет.
 */
import { createConnection } from 'node:net'
import {
  OrchestrationEnv,
  PARENT_ADDRESS,
  type OrchestrationMethod,
  type OrchestrationMethods,
  type OrchestrationResponse
} from '../shared/orchestration'

const USAGE = `Usage: atox <command>

Delegate work to another agent in a new Atox chat in the same folder.

  atox agents                              List installed agents
  atox start <agent> [--title <name>] <task>
                                           Start a worker agent with a task; its report
                                           arrives in your chat as a new message.
                                           Pass "-" as the task to read it from stdin.
  atox workers                             List your workers
  atox send <chat-id|${PARENT_ADDRESS}> <message>     Message one of your workers, or your parent agent
  atox report <summary>                    Worker: report the result to the parent agent

Works only in terminals inside Atox.`

/** Сколько ждать ответа приложения: команды выполняются сразу и не ждут работы агентов. */
const RESPONSE_TIMEOUT_MS = 30_000

class UsageError extends Error {}

async function main(args: string[]): Promise<string> {
  const [command, ...rest] = args
  switch (command) {
    case 'agents': {
      const agents = await call('agents', {})
      return agents.length > 0
        ? agents.map(({ id, name }) => `${id}\t${name}`).join('\n')
        : 'No agents are installed.'
    }
    case 'start': {
      const { values, positional } = parseFlags(rest, ['title'])
      const [agent, ...taskWords] = positional
      if (!agent) {
        throw new UsageError('Specify the agent, for example: atox start codex "<task>"')
      }
      const task = await readText(taskWords, 'task')
      const worker = await call('start', { agent, task, title: values['title'] })
      return `Started worker "${worker.title}" (chat ${worker.chatId}). Its report will arrive in this chat as a new message; you can keep working meanwhile.`
    }
    case 'workers': {
      const workers = await call('workers', {})
      return workers.length > 0
        ? workers
            .map(({ chatId, title, agent, running, reported }) => {
              const state = reported ? 'reported' : running ? 'working' : 'stopped'
              return `${chatId}\t${agent}\t${state}\t${title}`
            })
            .join('\n')
        : 'You have no workers.'
    }
    case 'send': {
      const [to, ...messageWords] = rest
      if (!to) {
        throw new UsageError(`Specify the recipient: a worker chat id or "${PARENT_ADDRESS}".`)
      }
      await call('send', { to, message: await readText(messageWords, 'message') })
      return 'Message delivered.'
    }
    case 'report': {
      await call('report', { summary: await readText(rest, 'summary') })
      return 'Report delivered to the parent agent. Your task is complete.'
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return USAGE
    default:
      throw new UsageError(`Unknown command: ${command}\n\n${USAGE}`)
  }
}

/** Значения флагов `--name value` и остальные аргументы по порядку. */
function parseFlags(
  args: string[],
  names: string[]
): { values: Record<string, string>; positional: string[] } {
  const values: Record<string, string> = {}
  const positional: string[] = []
  for (let index = 0; index < args.length; index++) {
    const name = args[index]!.replace(/^--/, '')
    if (args[index]!.startsWith('--') && names.includes(name)) {
      const value = args[++index]
      if (value === undefined) {
        throw new UsageError(`--${name} needs a value.`)
      }
      values[name] = value
    } else {
      positional.push(args[index]!)
    }
  }
  return { values, positional }
}

/**
 * Текст из аргументов; «-» — читать stdin. Без явного «-» stdin не читается: у инструментов
 * агентов он бывает открытым каналом, который никогда не закроется.
 */
async function readText(words: string[], name: string): Promise<string> {
  const fromStdin = words.length === 1 && words[0] === '-'
  const text = fromStdin ? await readStdin() : words.join(' ')
  if (!text.trim()) {
    throw new UsageError(`The ${name} is empty.`)
  }
  return text
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function call<Method extends OrchestrationMethod>(
  method: Method,
  params: OrchestrationMethods[Method]['params']
): Promise<OrchestrationMethods[Method]['result']> {
  const socketPath = process.env[OrchestrationEnv.Socket]
  const token = process.env[OrchestrationEnv.Token]
  const chatId = process.env[OrchestrationEnv.ChatId]
  if (!socketPath || !token || !chatId) {
    return Promise.reject(
      new Error('atox works only in terminals of Atox chats opened after Atox was updated.')
    )
  }

  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let response = ''
    socket.setEncoding('utf8')
    socket.setTimeout(RESPONSE_TIMEOUT_MS, () => {
      socket.destroy()
      reject(new Error('Atox did not respond. Make sure the app is running.'))
    })
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ token, chatId, method, params })}\n`)
    )
    socket.on('data', (chunk: string) => (response += chunk))
    socket.on('error', (error: NodeJS.ErrnoException) =>
      reject(
        new Error(
          error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
            ? 'Atox is not running.'
            : `Could not connect to Atox (${error.code ?? error.message}). If a sandbox blocks it, run the command again with elevated permissions.`
        )
      )
    )
    socket.on('end', () => {
      try {
        const parsed = JSON.parse(response) as OrchestrationResponse<Method>
        if (parsed.ok) {
          resolve(parsed.result)
        } else {
          reject(new Error(parsed.error))
        }
      } catch {
        reject(new Error('Atox returned an invalid response.'))
      }
    })
  })
}

main(process.argv.slice(2)).then(
  (output) => {
    process.stdout.write(`${output}\n`)
  },
  (error: unknown) => {
    process.stderr.write(`atox: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = error instanceof UsageError ? 2 : 1
  }
)
