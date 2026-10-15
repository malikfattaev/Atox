// Главная кнопка ведёт на сборку под процессор посетителя, вторая ссылка — на другую сборку.
const BUILDS = {
  arm64: { href: '/download/arm64', label: 'Apple Silicon' },
  x64: { href: '/download/x64', label: 'Intel Mac' }
}

/**
 * Браузеры на Mac всегда пишут «Intel» в user agent. Отличить Intel можно по видеокарте:
 * на Apple Silicon WebGL сообщает «Apple M…» или «Apple GPU».
 */
function detectMacArchitecture() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''
    return /intel|amd|radeon|nvidia/i.test(renderer) ? 'x64' : 'arm64'
  } catch {
    return 'arm64'
  }
}

function setUpDownloadButtons() {
  const primary = document.querySelectorAll('[data-download="primary"]')
  const alternate = document.querySelectorAll('[data-download="alternate"]')
  if (primary.length === 0) {
    return
  }
  const arch = detectMacArchitecture()
  const other = arch === 'arm64' ? 'x64' : 'arm64'
  primary.forEach((link) => (link.href = BUILDS[arch].href))
  alternate.forEach((link) => {
    link.href = BUILDS[other].href
    link.textContent = BUILDS[other].label
  })
}

/** Версия последнего релиза рядом с кнопками загрузки. */
function showReleaseVersion() {
  const meta = document.querySelector('[data-release-meta]')
  const version = document.querySelector('[data-release-version]')
  if (!meta && !version) {
    return
  }
  fetch('/api/release')
    .then((response) => (response.ok ? response.json() : null))
    .then((release) => {
      if (!release?.version) {
        return
      }
      if (meta) {
        meta.textContent = `Version ${release.version} · Free · macOS · Apple Silicon and Intel`
      }
      if (version) {
        version.textContent = `· v${release.version}`
      }
    })
    .catch(() => {})
}

/** Раздел документации, который сейчас на экране, подсвечивается в боковом меню. */
function highlightDocsSection() {
  const links = new Map(
    [...document.querySelectorAll('.docs__nav a')].map((link) => [
      decodeURIComponent(link.hash.slice(1)),
      link
    ])
  )
  if (links.size === 0) {
    return
  }
  const sections = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean)
  const update = () => {
    // Текущий раздел — последний, чей заголовок уже прокручен до верхней трети экрана.
    const threshold = window.innerHeight / 3
    const current = sections.filter((section) => section.getBoundingClientRect().top <= threshold).at(-1)
    links.forEach((link, id) => link.setAttribute('aria-current', String(id === (current ?? sections[0]).id)))
  }
  update()
  window.addEventListener('scroll', update, { passive: true })
}

setUpDownloadButtons()
showReleaseVersion()
highlightDocsSection()
