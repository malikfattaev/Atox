/** Версия последнего релиза рядом с кнопками загрузки. */
function showReleaseVersion() {
  const versions = document.querySelectorAll('[data-release-version]')
  if (versions.length === 0) {
    return
  }
  fetch('/api/release')
    .then((response) => (response.ok ? response.json() : null))
    .then((release) => {
      if (!release?.version) {
        return
      }
      versions.forEach((version) => {
        version.textContent = `· v${release.version}`
      })
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
    // Текущий раздел — последний, чей заголовок уже прокручен до верхней трети экрана. У конца
    // страницы эта линия плавно опускается к низу экрана: короткие последние разделы не могут
    // подняться выше, и без этого подсвечивался бы раздел, оставшийся выше них.
    const viewport = window.innerHeight
    const left = document.documentElement.scrollHeight - (window.scrollY + viewport)
    const nearBottom = 1 - Math.min(Math.max(left / (viewport / 3), 0), 1)
    const threshold = viewport / 3 + ((viewport * 2) / 3) * nearBottom
    const current = sections.filter((section) => section.getBoundingClientRect().top <= threshold).at(-1)
    links.forEach((link, id) => link.setAttribute('aria-current', String(id === (current ?? sections[0]).id)))
  }
  update()
  window.addEventListener('scroll', update, { passive: true })
}

showReleaseVersion()
highlightDocsSection()
