/**
 * Отмечает на корневом элементе, в фокусе ли окно: по этой отметке стили останавливают
 * анимации, которые незачем крутить, пока пользователь работает в другом приложении.
 */
export function trackWindowFocus(): void {
  const root = document.documentElement
  const update = () => {
    root.dataset.windowFocused = String(document.hasFocus())
  }
  update()
  window.addEventListener('focus', update)
  window.addEventListener('blur', update)
}
