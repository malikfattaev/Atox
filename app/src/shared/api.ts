import type { AgentId } from './agents'
import type { MessageAttachments, PickedFile } from './attachments'
import type { ChangesResult, FileDiff } from './changes'
import type { AppCommand } from './commands'
import type {
  AgentCatalog,
  AgentCommand,
  ChatCommand,
  ChatConfiguration,
  ConversationEvent,
  ConversationSnapshot,
  ConversationSummary,
  RequestAnswer,
  UserRequestKind
} from './conversation'
import type { Project, SpacesState, UserProfile } from './models'
import type {
  Commit,
  GitHubCounts,
  GitHubItems,
  GitHubKind,
  GitHubOverview,
  ListState,
  Listing,
  Page,
  RepositoryResult
} from './repository'
import type { ProjectColor } from './projectColors'
import type { Settings } from './settings'
import type { UpdateState } from './update'

/** Размер терминала в символах. */
export interface TerminalSize {
  cols: number
  rows: number
}

/** Текущая ветка git по пути папки проекта; `null` — папка не репозиторий git. */
export type GitBranches = Record<string, string | null>

/** API, который preload пробрасывает в renderer как `window.atox`. */
export interface AtoxApi {
  projects: {
    list(): Promise<Project[]>
    /**
     * Открывает системный диалог выбора папки и добавляет её в пространство. Если папка уже
     * добавлена, возвращает её проект. `null` — пользователь закрыл диалог.
     */
    add(spaceId: string): Promise<{ projects: Project[]; projectId: string } | null>
    /** Переносит проект в другое пространство. */
    moveToSpace(projectId: string, spaceId: string): Promise<Project[]>
    remove(projectId: string): Promise<Project[]>
    rename(projectId: string, name: string): Promise<Project[]>
    /** Цвет папки проекта; `null` — без цвета. */
    setColor(projectId: string, color: ProjectColor | null): Promise<Project[]>
    /** Запоминает чаты проекта, открытые рядом (слева направо); `null` — один чат. */
    setSplit(projectId: string, chatIds: [string, string] | null): Promise<Project[]>
    /** Положение разделителя между чатами — доля ширины левого. */
    setSplitPosition(projectId: string, position: number): Promise<Project[]>
    /** Переносит проект на позицию `toIndex` в списке. */
    move(projectId: string, toIndex: number): Promise<Project[]>
    /** Открывает папку проекта в Finder. */
    reveal(projectId: string): Promise<void>
  }
  spaces: {
    list(): Promise<SpacesState>
    /** Создаёт пространство и открывает его. */
    create(): Promise<SpacesState>
    rename(spaceId: string, name: string): Promise<SpacesState>
    setColor(spaceId: string, color: ProjectColor | null): Promise<SpacesState>
    setActive(spaceId: string): Promise<SpacesState>
    /**
     * Удаляет пространство, переносив его проекты в соседнее (после подтверждения, если они есть).
     * `null` — пользователь передумал.
     */
    remove(spaceId: string): Promise<{ spaces: SpacesState; projects: Project[] } | null>
  }
  agents: {
    /** Агенты, которые установлены на компьютере. */
    available(): Promise<AgentId[]>
    /** Модели агента; `null` — агент не установлен или не ответил. */
    catalog(agent: AgentId): Promise<AgentCatalog | null>
  }
  chats: {
    /**
     * Создаёт чат с агентом. Выбранный агент становится агентом по умолчанию; без агента
     * берётся агент по умолчанию.
     */
    create(projectId: string, agent?: AgentId): Promise<{ projects: Project[]; chatId: string }>
    remove(chatId: string): Promise<Project[]>
    /** Переименование пользователем: после него первое сообщение название не меняет. */
    rename(chatId: string, title: string): Promise<Project[]>
    /** Переносит чат на позицию `toIndex` среди чатов верхнего уровня его проекта. */
    move(chatId: string, toIndex: number): Promise<Project[]>
    /** Меняет агента, модель или эффорт чата. */
    configure(chatId: string, configuration: ChatConfiguration): Promise<Project[]>
    /** Список чатов изменился без участия окна — например, агент запустил помощника. */
    onChanged(listener: (projects: Project[]) => void): () => void
  }
  conversations: {
    /** Лента чата и то, работает ли сейчас его агент. */
    snapshot(chatId: string): Promise<ConversationSnapshot>
    /** Сводки всех начатых разговоров — для обзора агентов. */
    summaries(): Promise<ConversationSummary[]>
    /** `attachments` — пути к картинкам и файлам, которые агент получит вместе с текстом. */
    send(chatId: string, text: string, attachments?: MessageAttachments): Promise<void>
    /** Команды агента чата для подсказок после «/». */
    commands(chatId: string): Promise<AgentCommand[]>
    /** Выполняет команду Atox (`/usage`, `/context`, `/clear`), не отправляя её агенту. */
    runCommand(chatId: string, command: ChatCommand): Promise<void>
    /** Останавливает ответ агента и отменяет сообщения, ждущие очереди. */
    interrupt(chatId: string): Promise<void>
    /** Ответ на разрешение, вопросы или форму агента — элемент ленты `approval` или `question`. */
    answerRequest(chatId: string, itemId: string, answer: RequestAnswer): Promise<void>
    /** События ленты одного чата. */
    onEvent(chatId: string, listener: (event: ConversationEvent) => void): () => void
    /** В каком-либо чате что-то произошло: пора обновить обзор агентов. */
    onAnyEvent(listener: () => void): () => void
    /** Агент какого-либо чата начал или закончил работу. */
    onRunningChange(listener: (chatId: string, running: boolean) => void): () => void
    /** Агент какого-либо чата начал (`waitingFor`) или перестал (`null`) ждать ответа. */
    onWaitingChange(
      listener: (chatId: string, waitingFor: UserRequestKind | null) => void
    ): () => void
  }
  /** Терминал проекта в панели справа от чатов: оболочка в папке проекта. */
  terminals: {
    /** Запускает оболочку проекта, если она не запущена, и возвращает её накопленный вывод. */
    attach(projectId: string, size: TerminalSize): Promise<string>
    write(projectId: string, data: string): void
    resize(projectId: string, size: TerminalSize): void
    onData(projectId: string, listener: (data: string) => void): () => void
    /** Оболочка завершилась, например по `exit`. */
    onExit(projectId: string, listener: () => void): () => void
  }
  files: {
    /** Путь на диске к файлу, перетащенному в окно. */
    getPath(file: File): string
    /** Системный диалог выбора файлов для сообщения; пустой список — пользователь передумал. */
    pick(): Promise<PickedFile[]>
    /** Сохраняет вставленную картинку во временный файл и возвращает путь к нему. */
    savePastedImage(image: File): Promise<string>
  }
  git: {
    branches(): Promise<GitBranches>
    subscribe(listener: (branches: GitBranches) => void): () => void
  }
  /** Незакоммиченные изменения в папке проекта. */
  changes: {
    list(projectId: string): Promise<ChangesResult>
    /** Изменения файла построчно; `null` — файл уже не изменён. */
    diff(projectId: string, path: string): Promise<FileDiff | null>
    /** Спрашивает подтверждение и возвращает файл к последнему коммиту; `false` — передумали. */
    discard(projectId: string, path: string): Promise<boolean>
  }
  repository: {
    /**
     * Последние коммиты текущей ветки проекта — из локального git, без сети. `loaded` — сколько
     * уже показано: обновление загружает не меньше, чтобы список не укоротился.
     */
    commits(projectId: string, loaded?: number): Promise<RepositoryResult<Listing<Commit>>>
    /** Следующая страница коммитов после `cursor` из предыдущей. */
    moreCommits(projectId: string, cursor: string): Promise<RepositoryResult<Page<Commit>>>
    /** Первые страницы pull request'ов и issue проекта с GitHub. */
    github(projectId: string, loaded?: GitHubCounts): Promise<RepositoryResult<GitHubOverview>>
    /** Следующая страница одного из списков GitHub. */
    moreGitHub<Kind extends GitHubKind>(
      projectId: string,
      kind: Kind,
      state: ListState,
      cursor: string
    ): Promise<RepositoryResult<Page<GitHubItems[Kind]>>>
  }
  updates: {
    /** Скачивается ли новая версия или она уже готова к установке; `null` — обновлений нет. */
    state(): Promise<UpdateState>
    subscribe(listener: (state: UpdateState) => void): () => void
    /** Перезапускает приложение с установкой обновления. */
    install(): void
  }
  shortcuts: {
    /**
     * Пока в настройках записывают новое сочетание, горячие клавиши меню не срабатывают:
     * иначе нажатое сочетание выполнило бы команду вместо того, чтобы записаться.
     */
    setRecording(recording: boolean): void
  }
  system: {
    getUserProfile(): Promise<UserProfile>
    /** Выводит окно приложения на передний план, например по клику на уведомление. */
    focusWindow(): void
    /** Число на иконке приложения в доке: сколько чатов ждут пользователя; 0 — убрать. */
    setBadgeCount(count: number): void
  }
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
    subscribe(listener: (settings: Settings) => void): () => void
  }
  commands: {
    subscribe(listener: (command: AppCommand) => void): () => void
  }
}

export const IpcChannel = {
  ProjectsList: 'projects:list',
  ProjectsAdd: 'projects:add',
  ProjectsRemove: 'projects:remove',
  ProjectsRename: 'projects:rename',
  ProjectsSetColor: 'projects:set-color',
  ProjectsMoveToSpace: 'projects:move-to-space',
  SpacesList: 'spaces:list',
  SpacesCreate: 'spaces:create',
  SpacesRename: 'spaces:rename',
  SpacesSetColor: 'spaces:set-color',
  SpacesSetActive: 'spaces:set-active',
  SpacesRemove: 'spaces:remove',
  ProjectsSetSplit: 'projects:set-split',
  ProjectsSetSplitPosition: 'projects:set-split-position',
  ProjectsMove: 'projects:move',
  ProjectsReveal: 'projects:reveal',
  AgentsAvailable: 'agents:available',
  AgentsCatalog: 'agents:catalog',
  ChatsCreate: 'chats:create',
  ChatsRemove: 'chats:remove',
  ChatsRename: 'chats:rename',
  ChatsMove: 'chats:move',
  ChatsConfigure: 'chats:configure',
  ProjectsChanged: 'projects:changed',
  ConversationsSnapshot: 'conversations:snapshot',
  ConversationsSummaries: 'conversations:summaries',
  ConversationsSend: 'conversations:send',
  ConversationsInterrupt: 'conversations:interrupt',
  ConversationsAnswerRequest: 'conversations:answer-request',
  ConversationsCommands: 'conversations:commands',
  ConversationsRunCommand: 'conversations:run-command',
  ConversationsEvent: 'conversations:event',
  TerminalsAttach: 'terminals:attach',
  TerminalsWrite: 'terminals:write',
  TerminalsResize: 'terminals:resize',
  TerminalsData: 'terminals:data',
  TerminalsExit: 'terminals:exit',
  FilesSavePastedImage: 'files:save-pasted-image',
  FilesPick: 'files:pick',
  GitBranches: 'git:branches',
  GitBranchesChanged: 'git:branches-changed',
  ChangesList: 'changes:list',
  ChangesDiff: 'changes:diff',
  ChangesDiscard: 'changes:discard',
  RepositoryCommits: 'repository:commits',
  RepositoryMoreCommits: 'repository:more-commits',
  RepositoryGitHub: 'repository:github',
  RepositoryMoreGitHub: 'repository:more-github',
  UpdatesState: 'updates:state',
  UpdatesStateChanged: 'updates:state-changed',
  UpdatesInstall: 'updates:install',
  SystemUserProfile: 'system:user-profile',
  SystemFocusWindow: 'system:focus-window',
  SystemBadgeCount: 'system:badge-count',
  AppCommand: 'app:command',
  SettingsGet: 'settings:get',
  SettingsUpdate: 'settings:update',
  SettingsChanged: 'settings:changed',
  ShortcutsRecording: 'shortcuts:recording'
} as const
