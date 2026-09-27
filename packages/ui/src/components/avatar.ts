export function avatarUrl(login: string, size = 24): string {
  return `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=${size * 2}`;
}
