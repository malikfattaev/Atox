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
import type { IntegrationKind, IntegrationList } from './integrations'
import type { Project, SpacesState, UserProfile } from './models'
import type { PlanLimitsState } from './planLimits'
import type { TokenSpendSummary } from './tokenSpend'
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
import type { ProjectIcon } from './projectIcons'
import type { Settings } from './settings'
import type { UpdateCheckResult, UpdateState } from './update'

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
    /** Значок проекта вместо папки; `null` — обычная папка. */
    setIcon(projectId: string, icon: ProjectIcon | null): Promise<Project[]>
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
    /** Запоминает чат в фокусе как последний открытый в его пространстве. */
    rememberChat(chatId: string): void
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
    /** Списки моделей агента устарели — например, после входа в другой аккаунт. */
    subscribeListsStale(listener: (agent: AgentId) => void): () => void
    /**
     * Плагины, скиллы или серверы MCP агента — вместе с проектными у `projectId`. Ответ бывает
     * долгим: агент запускается, а серверы MCP успевают подключиться.
     */
    integrations<Kind extends IntegrationKind>(
      agent: AgentId,
      kind: Kind,
      projectId: string | null
    ): Promise<IntegrationList<Kind>>
  }
  chats: {
    /**
     * Создаёт чат с агентом. Выбранный агент становится агентом по умолчанию; без агента
     * берётся агент по умолчанию.
     */
    create(projectId: string, agent?: AgentId): Promise<{ projects: Project[]; chatId: string }>
    remove(chatId: string): Promise<Project[]>
    /**
     * Убирает чат в архив вместе с его помощниками (после подтверждения, если их агенты
     * работают — архив их останавливает). История чата остаётся.
     */
    archive(chatId: string): Promise<Project[]>
    /** Возвращает чат из архива наверх списка его проекта. */
    restore(chatId: string): Promise<Project[]>
    /** Удаляет чат из архива вместе с историей — после подтверждения. */
    removeArchived(chatId: string): Promise<Project[]>
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
    /** Останавливает текущий ответ агента; сообщения в очереди уходят ему следом. */
    interrupt(chatId: string): Promise<void>
    /** Убирает сообщение из очереди, пока агент его не взял. */
    cancelQueued(chatId: string, itemId: string): Promise<void>
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
    /**
     * Открывает файл или папку по ссылке из ответа агента; относительный путь — от
     * `baseDirectory`. Программы и скрипты не запускаются, а показываются в файловом менеджере.
     */
    open(path: string, baseDirectory?: string): Promise<void>
  }
  images: {
    /** Картинка с диска как data URL; `null` — файла нет, он слишком большой или это не картинка. */
    read(path: string): Promise<string | null>
    /** Диалог «Сохранить как» для картинки; `false` — пользователь передумал. */
    saveAs(path: string): Promise<boolean>
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
    /** Версия запущенного приложения. */
    currentVersion(): Promise<string>
    /** Проверяет обновления сейчас; новая версия сразу начинает скачиваться. */
    check(): Promise<UpdateCheckResult>
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
  planLimits: {
    /** Последние известные лимиты подписки агентов. */
    get(): Promise<PlanLimitsState>
    subscribe(listener: (state: PlanLimitsState) => void): () => void
    /** Принудительно перечитать лимиты у всех агентов — например, после смены аккаунта. */
    refresh(): Promise<void>
  }
  tokenSpend: {
    /** Сколько токенов потратили агенты: сегодня и за всё время. */
    get(): Promise<TokenSpendSummary>
    subscribe(listener: (summary: TokenSpendSummary) => void): () => void
  }
  settings: {
    /**
     * Синхронно: раскладка (ширина сайдбара, терминала) нужна уже в первом кадре — иначе
     * окно сначала отрисовалось бы с размерами по умолчанию, а потом прыгнуло.
     */
    get(): Settings
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
  ProjectsSetIcon: 'projects:set-icon',
  ProjectsMoveToSpace: 'projects:move-to-space',
  SpacesList: 'spaces:list',
  SpacesCreate: 'spaces:create',
  SpacesRename: 'spaces:rename',
  SpacesSetColor: 'spaces:set-color',
  SpacesSetActive: 'spaces:set-active',
  SpacesRememberChat: 'spaces:remember-chat',
  SpacesRemove: 'spaces:remove',
  ProjectsSetSplit: 'projects:set-split',
  ProjectsSetSplitPosition: 'projects:set-split-position',
  ProjectsMove: 'projects:move',
  ProjectsReveal: 'projects:reveal',
  AgentsAvailable: 'agents:available',
  AgentsCatalog: 'agents:catalog',
  AgentsIntegrations: 'agents:integrations',
  ChatsCreate: 'chats:create',
  ChatsRemove: 'chats:remove',
  ChatsArchive: 'chats:archive',
  ChatsRestore: 'chats:restore',
  ChatsRemoveArchived: 'chats:remove-archived',
  ChatsRename: 'chats:rename',
  ChatsMove: 'chats:move',
  ChatsConfigure: 'chats:configure',
  ProjectsChanged: 'projects:changed',
  ConversationsSnapshot: 'conversations:snapshot',
  ConversationsSummaries: 'conversations:summaries',
  ConversationsSend: 'conversations:send',
  ConversationsInterrupt: 'conversations:interrupt',
  ConversationsCancelQueued: 'conversations:cancel-queued',
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
  FilesOpen: 'files:open',
  ImagesRead: 'images:read',
  ImagesSaveAs: 'images:save-as',
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
  UpdatesCheck: 'updates:check',
  UpdatesCurrentVersion: 'updates:current-version',
  SystemUserProfile: 'system:user-profile',
  SystemFocusWindow: 'system:focus-window',
  SystemBadgeCount: 'system:badge-count',
  AppCommand: 'app:command',
  PlanLimitsGet: 'plan-limits:get',
  PlanLimitsRefresh: 'plan-limits:refresh',
  PlanLimitsChanged: 'plan-limits:changed',
  AgentsListsStale: 'agents:lists-stale',
  TokenSpendGet: 'token-spend:get',
  TokenSpendChanged: 'token-spend:changed',
  SettingsGet: 'settings:get',
  SettingsUpdate: 'settings:update',
  SettingsChanged: 'settings:changed',
  ShortcutsRecording: 'shortcuts:recording'
} as const
