export function avatarUrl(login: string, size = 24): string {
  return `https://github.com/${encodeURIComponent(login)}.png?size=${size * 2}`;
}
