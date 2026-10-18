/**
 * Собирает и подписывает описание релиза для обновлений:
 * `npm run release:manifest -- <dist> <version> <mac|linux>`.
 * Закрытый ключ Ed25519 (PEM) берётся из переменной окружения ATOX_UPDATE_SIGNING_KEY.
 */
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isUpdatePlatform,
  UPDATE_PLATFORMS,
  updateSignaturePayload,
  type UpdateFile,
  type UpdateManifest
} from '../src/shared/update.ts'

/** Архитектура в имени файла (её пишет electron-builder) → `process.arch` приложения. */
const ARCHITECTURES: Readonly<Record<string, string>> = {
  arm64: 'arm64',
  aarch64: 'arm64',
  x64: 'x64',
  x86_64: 'x64'
}

const [distDir, version, platform] = process.argv.slice(2)
const signingKey = process.env['ATOX_UPDATE_SIGNING_KEY']
if (!distDir || !version || !platform || !isUpdatePlatform(platform) || !signingKey) {
  throw new Error(
    'Usage: ATOX_UPDATE_SIGNING_KEY=<pem> npm run release:manifest -- <dist> <version> <mac|linux>'
  )
}
const { manifest: manifestName, extension } = UPDATE_PLATFORMS[platform]

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

// Имена файлов задаёт artifactName в настройках electron-builder: `Atox-0.1.42-arm64.zip`.
const prefix = `${productName}-${version}-`
const suffix = `.${extension}`
const files: UpdateManifest['files'] = {}
for (const name of await readdir(distDir)) {
  const arch =
    name.startsWith(prefix) && name.endsWith(suffix)
      ? ARCHITECTURES[name.slice(prefix.length, -suffix.length)]
      : undefined
  if (arch) {
    files[arch] = await describeFile(name)
  }
}
if (Object.keys(files).length === 0) {
  throw new Error(`No ${prefix}<arch>${suffix} files in ${distDir}`)
}

const unsigned = { version, files }
const signature = sign(
  null,
  Buffer.from(updateSignaturePayload(unsigned)),
  createPrivateKey(signingKey)
).toString('base64')
const manifest: UpdateManifest = { ...unsigned, signature }

await writeFile(join(distDir, manifestName), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`${manifestName}: ${version}, ${Object.keys(files).sort().join(', ')}`)
