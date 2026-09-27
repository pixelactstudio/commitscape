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
