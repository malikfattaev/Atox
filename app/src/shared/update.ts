/** Имя файла с описанием последнего релиза — он лежит среди файлов релиза на GitHub. */
export const UPDATE_MANIFEST_NAME = 'latest-mac.json'

/** Архив со сборкой под одну архитектуру процессора. */
export interface UpdateFile {
  name: string
  /** SHA-512 архива в base64. */
  sha512: string
  size: number
}

/** Описание релиза: версия и архивы под каждую архитектуру, подписанные ключом Atox. */
export interface UpdateManifest {
  version: string
  files: Partial<Record<string, UpdateFile>>
  /** Подпись Ed25519 (base64) над {@link updateSignaturePayload}. */
  signature: string
}

/**
 * Данные, которые подписываются: версия и для каждого архива его имя, хеш и размер.
 * Строка собирается одинаково при выпуске релиза и при проверке, независимо от порядка ключей.
 */
export function updateSignaturePayload(manifest: Omit<UpdateManifest, 'signature'>): string {
  const files = Object.entries(manifest.files)
    .flatMap(([arch, file]) => (file ? [`${arch} ${file.name} ${file.sha512} ${file.size}`] : []))
    .sort()
  return ['atox-update-v1', manifest.version, ...files].join('\n')
}

/** Сравнивает версии вида `0.1.42` по числам: отрицательное — `a` старше, положительное — новее. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

/** Имя файла релиза: без путей и спецсимволов, чтобы его нельзя было подменить адресом. */
export function isSafeReleaseFileName(name: string): boolean {
  return /^[\w.-]+$/.test(name) && !name.startsWith('.')
}
