import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { rawPath } from "@commitscape/data";
import { gitKey, type GitSource } from "../git/source";

export const LFS = "version https://git-lfs.github.com/spec/";

/** A file's text at HEAD: straight from raw.githubusercontent.com when the repository is public, else, and on any error there, through the Site's blob route. */
export async function readText(git: Pick<GitSource, "text">, raw: string | null | undefined, path: string, sha: string): Promise<string> {
  if (raw) {
    const answer = await fetch(`${raw}${rawPath(path)}`).catch(() => null);
    const text = answer?.ok ? await answer.text().catch(() => null) : null;
    if (text !== null) return text;
  }
  return git.text(sha);
}

export const treeQuery = (git: GitSource) => queryOptions({ queryKey: gitKey(git, "tree"), queryFn: () => git.tree(), staleTime: Infinity, retry: 1 });

export const storyQuery = (git: GitSource, path: string) => queryOptions({ queryKey: gitKey(git, "story", path), queryFn: () => git.story(path), staleTime: Infinity, retry: 1 });

export const couplingQuery = (git: GitSource) => queryOptions({ queryKey: gitKey(git, "coupling"), queryFn: () => git.coupling(), staleTime: Infinity, retry: 1 });

export const lastQuery = (git: GitSource, folder: string) => queryOptions({ queryKey: gitKey(git, "last", folder), queryFn: () => git.lastIn(folder), staleTime: Infinity, retry: 1 });

export const textQuery = (git: GitSource, raw: string | null | undefined, path: string, sha: string) =>
  queryOptions({ queryKey: gitKey(git, "text", sha), queryFn: () => readText(git, raw, path, sha), staleTime: Infinity, gcTime: 10 * 60_000, retry: 1, enabled: sha !== "" });

export const logQuery = (git: GitSource, path: string) =>
  infiniteQueryOptions({
    queryKey: gitKey(git, "log", path),
    queryFn: ({ pageParam }) => git.log(path, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
    staleTime: Infinity,
    retry: 1,
  });

/** What a Git LFS pointer says of the file it stands for, or null when the text is not one. */
export function lfsOf(text: string): { oid: string; size: number } | null {
  if (!text.startsWith(LFS) || text.length > 400) return null;
  const oid = /oid sha256:([0-9a-f]{64})/.exec(text)?.[1];
  const size = Number(/size (\d+)/.exec(text)?.[1]);
  return oid ? { oid, size: Number.isFinite(size) ? size : 0 } : null;
}

const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp"]);

/** Whether a file can be shown as a picture. */
export const isImage = (path: string): boolean => IMAGES.has(path.slice(path.lastIndexOf(".") + 1).toLowerCase());

export const isSvg = (path: string): boolean => path.toLowerCase().endsWith(".svg");

export const isMarkdown = (lang: string): boolean => lang === "markdown" || lang === "mdx";

export const SHOW_MAX = 1024 * 1024;

/** Whether a file has a drawn form beside its source: Markdown as prose, SVG as a picture. */
export const hasPreview = (path: string, lang: string): boolean => isMarkdown(lang) || isSvg(path);

/** The Staleness bucket a number of days since the last change falls in. */
export function stalenessOf(days: number): string {
  if (days < 7) return "under a week";
  if (days < 30) return "under a month";
  if (days < 90) return "under 3 months";
  if (days < 365) return "under a year";
  return "a year or more";
}
