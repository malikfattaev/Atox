import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT) || 3000
/** Репозиторий, из релизов которого скачивается Atox. */
const GITHUB_REPO = process.env.GITHUB_REPO || 'malikfattaev/Atox'
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`
/**
 * Манифест обновлений последнего релиза — тот же, по которому обновляется само приложение.
 * Скачивание файлов релиза, в отличие от API GitHub, не ограничено лимитом запросов.
 */
const LATEST_MANIFEST = `${RELEASES_PAGE}/download/latest-mac.json`

/** Сколько держать сведения о релизе, прежде чем спросить GitHub снова. */
const RELEASE_CACHE_MS = 5 * 60 * 1000
/** Сколько ждать ответа GitHub, прежде чем отдать то, что уже известно. */
const GITHUB_TIMEOUT_MS = 5000

/** Сборки Atox: суффикс в имени файла релиза — `Atox-<версия>-<arch>.dmg`. */
const ARCHITECTURES = new Set(['arm64', 'x64'])

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PUBLIC_DIR = join(ROOT, 'public')
const PAGES_DIR = join(ROOT, 'pages')
const PARTIALS_DIR = join(ROOT, 'partials')

/** Страницы сайта: адрес → файл и пункт меню, который на ней подсвечен. */
const PAGES = {
  '/': { file: 'index.html', nav: 'home' },
  '/features': { file: 'features.html', nav: 'features' },
  '/about': { file: 'about.html', nav: 'about' },
  '/download': { file: 'download.html', nav: 'download' }
}

/** Старые адреса, которые переехали: ссылки на них не должны ломаться. */
const MOVED_PAGES = {
  '/docs': '/download'
}
const NOT_FOUND_PAGE = { file: '404.html', nav: null }

/** Место в странице, куда вставляется общая шапка. */
const HEADER_SLOT = '<!-- header -->'

/** Ссылки страницы на свои стили и скрипты: к ним добавляется версия файла. */
const ASSET_REFERENCE = /(href|src)="(\/[^"?#]+\.(?:css|js))"/g

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
}

const HTML = 'text/html; charset=utf-8'

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY'
}

let cachedRelease = null
let cachedAt = 0
let pendingRelease = null

/** Последний релиз: версия и ссылки на .dmg по архитектурам. При сбое — то, что было. */
async function latestRelease() {
  if (cachedRelease && Date.now() - cachedAt < RELEASE_CACHE_MS) {
    return cachedRelease
  }
  pendingRelease ??= fetchRelease()
    .then((release) => {
      cachedRelease = release
      cachedAt = Date.now()
      return release
    })
    .catch((error) => {
      console.error('Failed to load the latest release', error)
      return cachedRelease
    })
    .finally(() => {
      pendingRelease = null
    })
  return pendingRelease
}

/**
 * Версия и ссылки на .dmg последнего релиза. GitHub отвечает на «последний релиз» переадресацией
 * на конкретный тег — из неё берётся адрес файлов релиза. В манифесте перечислены .zip для
 * обновлений; .dmg той же сборки называется так же, отличается только расширение.
 */
async function fetchRelease() {
  const pointer = await fetch(LATEST_MANIFEST, {
    redirect: 'manual',
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS)
  })
  const manifestUrl = pointer.headers.get('location')
  if (!manifestUrl) {
    throw new Error(`GitHub did not point to the latest release (${pointer.status})`)
  }
  const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`GitHub responded with ${response.status}`)
  }
  const manifest = await response.json()
  const releaseFiles = new URL('.', manifestUrl)
  const downloads = {}
  for (const arch of ARCHITECTURES) {
    const name = manifest.files?.[arch]?.name
    if (typeof name === 'string' && name.endsWith('.zip')) {
      downloads[arch] = new URL(name.replace(/\.zip$/, '.dmg'), releaseFiles).href
    }
  }
  return { version: String(manifest.version ?? ''), downloads }
}

/** Страница с общей шапкой; пункт меню текущей страницы отмечен для подсветки. */
async function renderPage({ file, nav }) {
  const [page, header] = await Promise.all([
    readFile(join(PAGES_DIR, file), 'utf-8'),
    readFile(join(PARTIALS_DIR, 'header.html'), 'utf-8')
  ])
  const marked = nav
    ? header.replace(`data-nav="${nav}"`, `data-nav="${nav}" aria-current="page"`)
    : header
  return versionAssets(page.replace(HEADER_SLOT, marked))
}

/**
 * Добавляет к ссылкам на стили и скрипты версию файла: изменённый файл получает новый адрес,
 * и браузер не может показать устаревший из своего кэша.
 */
async function versionAssets(html) {
  const paths = [...new Set([...html.matchAll(ASSET_REFERENCE)].map(([, , path]) => path))]
  const versions = new Map(
    await Promise.all(
      paths.map(async (path) => [path, await assetVersion(join(PUBLIC_DIR, path)).catch(() => null)])
    )
  )
  return html.replace(ASSET_REFERENCE, (match, attribute, path) => {
    const version = versions.get(path)
    return version ? `${attribute}="${path}?v=${version}"` : match
  })
}

/** Версия файла по размеру и времени изменения — меняется вместе с содержимым. */
async function assetVersion(filePath) {
  const info = await stat(filePath)
  return `${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}`
}

function send(response, status, headers, body) {
  response.writeHead(status, { ...SECURITY_HEADERS, ...headers })
  response.end(body)
}

function redirect(response, location, status = 302) {
  send(response, status, { Location: location, 'Cache-Control': 'no-store' })
}

async function handleDownload(response, arch) {
  const release = await latestRelease()
  // Без сведений о релизе человек всё равно попадает туда, где можно скачать.
  redirect(response, release?.downloads[arch] ?? RELEASES_PAGE)
}

async function handleReleaseInfo(response) {
  const release = await latestRelease()
  send(
    response,
    release ? 200 : 503,
    { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    JSON.stringify(release ? { version: release.version } : {})
  )
}

async function handlePage(response, page, status = 200) {
  send(response, status, { 'Content-Type': HTML, 'Cache-Control': 'no-cache' }, await renderPage(page))
}

async function handleStatic(request, response, pathname, versioned) {
  const filePath = normalize(join(PUBLIC_DIR, decodeURIComponent(pathname)))
  // Путь вида /../ не должен выводить за пределы папки сайта.
  const inside = filePath.startsWith(PUBLIC_DIR + sep)
  const type = CONTENT_TYPES[extname(filePath)]
  if (inside && type) {
    try {
      const etag = `"${await assetVersion(filePath)}"`
      // Адрес с версией меняется вместе с файлом — его можно хранить сколько угодно. Без версии
      // браузер каждый раз сверяется с сервером и не скачивает неизменившийся файл заново.
      const cache = versioned ? 'public, max-age=31536000, immutable' : 'no-cache'
      const headers = { 'Content-Type': type, 'Cache-Control': cache, ETag: etag }
      if (request.headers['if-none-match'] === etag) {
        return send(response, 304, headers)
      }
      return send(response, 200, headers, await readFile(filePath))
    } catch {
      // Ниже — общая страница «не найдено».
    }
  }
  await handlePage(response, NOT_FOUND_PAGE, 404)
}

const server = createServer(async (request, response) => {
  const { pathname, searchParams } = new URL(request.url ?? '/', 'http://localhost')
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return send(response, 405, { Allow: 'GET, HEAD' })
  }
  try {
    // Адрес со слешем на конце ведёт туда же, что и без него.
    if (pathname.length > 1 && pathname.endsWith('/')) {
      return redirect(response, pathname.replace(/\/+$/, ''), 301)
    }
    const [, section, arch] = pathname.split('/')
    if (section === 'download' && ARCHITECTURES.has(arch)) {
      return await handleDownload(response, arch)
    }
    if (MOVED_PAGES[pathname]) {
      return redirect(response, MOVED_PAGES[pathname], 301)
    }
    if (pathname === '/api/release') {
      return await handleReleaseInfo(response)
    }
    if (pathname === '/health') {
      return send(response, 200, { 'Content-Type': 'text/plain' }, 'ok')
    }
    const page = PAGES[pathname]
    if (page) {
      return await handlePage(response, page)
    }
    await handleStatic(request, response, pathname, searchParams.has('v'))
  } catch (error) {
    console.error('Request failed', pathname, error)
    if (!response.headersSent) {
      send(response, 500, { 'Content-Type': 'text/plain' }, 'Something went wrong')
    }
  }
})

server.listen(PORT, () => console.log(`Atox site is listening on port ${PORT}`))
