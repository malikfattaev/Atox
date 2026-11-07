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
    // Текущий раздел — последний, чей заголовок уже прокручен до верхней трети экрана.
    const threshold = window.innerHeight / 3
    const current = sections.filter((section) => section.getBoundingClientRect().top <= threshold).at(-1)
    links.forEach((link, id) => link.setAttribute('aria-current', String(id === (current ?? sections[0]).id)))
  }
  update()
  window.addEventListener('scroll', update, { passive: true })
}

showReleaseVersion()
highlightDocsSection()
