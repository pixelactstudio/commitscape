const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export function repoId(owner: string, name: string): string | null {
  if (!NAME.test(owner) || !NAME.test(name) || owner.startsWith(".") || name === "." || name === "..") return null;
  return `${owner}/${name}`.toLowerCase();
}
