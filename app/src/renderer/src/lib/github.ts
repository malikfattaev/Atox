/** Аватар учётной записи или организации GitHub по логину. */
export function githubAvatarUrl(login: string): string {
  return `https://avatars.githubusercontent.com/${encodeURIComponent(login)}`
}
