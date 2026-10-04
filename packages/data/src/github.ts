export type RepoName = { owner: string; name: string };

const PART = /^[A-Za-z0-9_.-]{1,100}$/;

/** A GitHub repository's owner and name from a link or `owner/name`. */
export function parseGitHub(input: string): RepoName | null {
  let text = input.trim();
  text = text.replace(/^git@github\.com:/i, "");
  text = text.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "");
  if (/^[a-z]+:\/\//i.test(text) || text.includes(" ")) return null;
  const [owner, rawName] = text.split(/[/?#]/);
  const name = rawName?.replace(/\.git$/i, "");
  if (!owner || !name || !PART.test(owner) || !PART.test(name) || name === "." || name === "..") return null;
  return { owner, name };
}

export type Target = { kind: "person"; login: string } | ({ kind: "repository" } & RepoName);

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** Whether a string is a GitHub login. */
export function isLogin(text: string): boolean {
  return LOGIN.test(text);
}

/** A GitHub person or repository from what someone typed: a login, @login, a profile link, owner/name or a repository link. */
export function parseTarget(input: string): Target | null {
  const text = input.trim().replace(/^@/, "");
  const profile = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(text);
  const login = profile ? profile[1] : text;
  if (login && isLogin(login)) return { kind: "person", login };
  const repo = parseGitHub(text);
  return repo ? { kind: "repository", ...repo } : null;
}
