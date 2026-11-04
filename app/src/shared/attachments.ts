/** Картинки, которые агенты принимают прямо в сообщении: MIME-тип и расширение файла. */
export const IMAGE_FORMATS = [
  { type: 'image/png', extensions: ['png'] },
  { type: 'image/jpeg', extensions: ['jpg', 'jpeg'] },
  { type: 'image/gif', extensions: ['gif'] },
  { type: 'image/webp', extensions: ['webp'] }
] as const

export type ImageType = (typeof IMAGE_FORMATS)[number]['type']

export function isImageType(type: string): type is ImageType {
  return IMAGE_FORMATS.some((format) => format.type === type)
}

/** MIME-тип картинки по пути файла; `undefined` — это не картинка, которую примет агент. */
export function imageTypeOfPath(path: string): ImageType | undefined {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return IMAGE_FORMATS.find((format) =>
    (format.extensions as readonly string[]).includes(extension)
  )?.type
}

/** Файл, выбранный кнопкой «+» в поле ввода. */
export interface PickedFile {
  path: string
  /** Картинка как data URL — для превью; нет — файл прикладывается путём. */
  preview?: string
}

/** Что приложено к сообщению: картинки агент видит сам, остальные файлы открывает по пути. */
export interface MessageAttachments {
  images?: readonly string[]
  files?: readonly string[]
}
