import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { quoteShell } from '../shellQuote'

/** Права исполняемого файла команды. */
const EXECUTABLE = 0o755

/**
 * Создаёт исполняемый файл `atox` в `binDirectory`: он запускает собранную команду бинарником
 * приложения в режиме Node, так что отдельный Node.js пользователю не нужен. Файл
 * пересоздаётся при каждом запуске: путь к приложению мог измениться после обновления.
 */
export async function installCli(
  binDirectory: string,
  executablePath: string,
  scriptPath: string
): Promise<string> {
  const cliPath = join(binDirectory, 'atox')
  const content = `#!/bin/sh
ELECTRON_RUN_AS_NODE=1 exec ${quoteShell(executablePath)} ${quoteShell(scriptPath)} "$@"
`
  await mkdir(binDirectory, { recursive: true })
  await writeFile(cliPath, content, { mode: EXECUTABLE })
  return cliPath
}

const SKILL = `---
name: atox
description: Delegate work to other coding agents (Claude Code, Codex) that run in parallel Atox chats, and talk to them. Use inside Atox (the ATOX_CHAT_ID environment variable is set) when the user asks to hand a task to another agent, run agents in parallel, or get a second opinion from Codex or Claude; also use it when you are an Atox worker that must report back.
---

# Atox agents

Inside Atox every chat is a terminal with a CLI agent. The \`atox\` command starts another agent in a new chat in the same folder; the user sees it nested under your chat. Its report comes back to your chat as a new message starting with "[Atox] Worker".

## Commands

\`\`\`sh
atox agents                                  # installed agents; start only these
atox start codex --title "Fix checkout" "<task>"
atox workers                                 # your workers, oldest first: id, agent, state, age, title
atox send <worker-chat-id> "<message>"       # follow-up or answer to a worker's question
atox remove <worker-chat-id> [...]           # stop workers and remove their chats
atox send parent "<question>"                # worker: ask the agent that started you
atox report "<summary>"                      # worker: final result, exactly once
\`\`\`

## Starting workers

- Run \`atox agents\` first. If the agent the user asked for is not installed, say so and offer the installed ones instead.
- Make each task self-contained: the files in scope, the change to make, constraints, and how to verify it. The worker sees nothing of your conversation.
- Workers share the folder with you and each other, so give them separate files or areas.
- After starting, keep working or end your turn. Do not poll or wait in a loop: the report arrives as a new message. Use \`atox workers\` only when the user asks for status.
- Workers cannot start workers of their own.

## Removing workers

- Remove a worker you started by mistake, or one the user no longer needs, with \`atox remove <worker-chat-id>\`. It stops the agent and deletes its chat; this cannot be undone.
- Remove a worker that is still working only when the user asks or the task was started by mistake: its unfinished work is lost.
- Take the ids from \`atox workers\`. You can remove only your own workers.

## As a worker

If your first message says you are a worker, do the task, then run \`atox report\` once with what you did, what you found, and what is left. Ask questions with \`atox send parent\`, not the user.

## Troubleshooting

- \`atox\` not found: run "$ATOX_CLI" with the same arguments.
- Blocked by a sandbox or permissions: run it again with elevated permissions; it only talks to the local Atox app.
`

/** Каталоги навыков агентов: Claude Code читает свой, Codex — общий для агентов ~/.agents. */
const SKILL_TARGETS = [
  { agentHome: '.claude', skillsDirectory: ['.claude', 'skills'] },
  { agentHome: '.codex', skillsDirectory: ['.agents', 'skills'] }
]

/**
 * Устанавливает навык `atox` тем агентам, что есть у пользователя, — так агент знает, что
 * может запускать помощников. Файл перезаписывается, только если его текст изменился.
 */
export async function installSkills(): Promise<void> {
  const home = homedir()
  await Promise.all(
    SKILL_TARGETS.filter(({ agentHome }) => existsSync(join(home, agentHome))).map(
      async ({ skillsDirectory }) => {
        const directory = join(home, ...skillsDirectory, 'atox')
        const file = join(directory, 'SKILL.md')
        const current = await readFile(file, 'utf8').catch(() => null)
        if (current !== SKILL) {
          await mkdir(directory, { recursive: true })
          await writeFile(file, SKILL)
        }
      }
    )
  )
}

/**
 * Правило Codex: `atox` запускается без вопроса и вне песочницы — иначе песочница не даёт
 * подключиться к сокету приложения, и каждую команду помощника пришлось бы одобрять вручную.
 * Codex читает все файлы правил из ~/.codex/rules.
 */
const CODEX_RULES = `prefix_rule(pattern=["atox"], decision="allow")
`

export async function installCodexRules(): Promise<void> {
  const codexHome = join(homedir(), '.codex')
  if (!existsSync(codexHome)) {
    return
  }
  const directory = join(codexHome, 'rules')
  const file = join(directory, 'atox.rules')
  if ((await readFile(file, 'utf8').catch(() => null)) !== CODEX_RULES) {
    await mkdir(directory, { recursive: true })
    await writeFile(file, CODEX_RULES)
  }
}
