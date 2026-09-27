/**
 * Собирает и подписывает описание релиза для обновлений: `npm run release:manifest -- <dist> <version>`.
 * Закрытый ключ Ed25519 (PEM) берётся из переменной окружения ATOX_UPDATE_SIGNING_KEY.
 */
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  UPDATE_MANIFEST_NAME,
  updateSignaturePayload,
  type UpdateFile,
  type UpdateManifest
} from '../src/shared/update.ts'

/** Архитектуры, под которые собирается релиз; имена совпадают с `process.arch`. */
const ARCHITECTURES = ['arm64', 'x64'] as const

const [distDir, version] = process.argv.slice(2)
const signingKey = process.env['ATOX_UPDATE_SIGNING_KEY']
if (!distDir || !version || !signingKey) {
  throw new Error(
    'Usage: ATOX_UPDATE_SIGNING_KEY=<pem> npm run release:manifest -- <dist> <version>'
  )
}

async function describeFile(name: string): Promise<UpdateFile> {
  const path = join(distDir, name)
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return { name, sha512: hash.digest('base64'), size: (await stat(path)).size }
}

const { productName } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
) as { productName: string }

const files: UpdateManifest['files'] = {}
for (const arch of ARCHITECTURES) {
  // Имя архива задаёт artifactName в настройках electron-builder.
  files[arch] = await describeFile(`${productName}-${version}-${arch}.zip`)
}

const unsigned = { version, files }
const signature = sign(
  null,
  Buffer.from(updateSignaturePayload(unsigned)),
  createPrivateKey(signingKey)
).toString('base64')
const manifest: UpdateManifest = { ...unsigned, signature }

await writeFile(join(distDir, UPDATE_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`${UPDATE_MANIFEST_NAME}: ${version}, ${ARCHITECTURES.join(', ')}`)
