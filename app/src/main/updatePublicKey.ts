/**
 * Открытый ключ Ed25519, которым проверяется подпись релизов. Закрытый ключ хранится
 * в секретах репозитория на GitHub (ATOX_UPDATE_SIGNING_KEY) — им подписывает релизы CI.
 */
export const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAmsWEZYmhv9AcxVNLPoPPV52MKCM56/PdUusvWDoih+c=
-----END PUBLIC KEY-----`
