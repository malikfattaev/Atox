/**
 * Схемы ссылок, которые Atox открывает внешним приложением — браузером и почтой. Остальные
 * не открываются: ссылку мог подставить вывод программы или ответ агента.
 */
export const EXTERNAL_LINK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:'])
