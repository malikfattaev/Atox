import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { protocol } from 'electron'
import { imageTypeOfPath } from '../shared/attachments'
import { IMAGE_PROTOCOL, imagePathOfUrl } from '../shared/imageProtocol'

const NOT_FOUND = 404

/**
 * Схему нужно объявить до готовности приложения. `secure` и `corsEnabled` нужны, чтобы
 * картинку можно было перерисовать на canvas и скопировать в буфер обмена.
 */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMAGE_PROTOCOL,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

/**
 * Отдаёт окну картинки с диска по `atox-image://`. Только картинки — те же файлы, что окно
 * и раньше читало по пути: другие файлы по этой схеме не прочитать.
 */
export function handleImageProtocol(): void {
  protocol.handle(IMAGE_PROTOCOL, async (request) => {
    const path = imagePathOfUrl(request.url)
    const type = path && isAbsolute(path) ? imageTypeOfPath(path) : undefined
    if (!path || !type) {
      return new Response(null, { status: NOT_FOUND })
    }
    try {
      const data = await readFile(path)
      return new Response(data, {
        headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' }
      })
    } catch {
      return new Response(null, { status: NOT_FOUND })
    }
  })
}
