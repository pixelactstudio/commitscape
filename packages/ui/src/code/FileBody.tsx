import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useQuery } from "@tanstack/react-query";
import { Binary, ExternalLink, FileQuestion, FileWarning, Files, Link2, PackageOpen, RefreshCw, Scale } from "lucide-react";
import { FILE_BINARY, FILE_BYTES_MAX, FILE_LINK, rawPath, type CodeStory } from "@commitscape/data";
import { A } from "../kit/A";
import { CodeView, LINE_HEIGHT } from "../git/CodeView";
import { bytes } from "../git/insights";
import { find } from "../git/tree";
import { nameOf, repoPathOf } from "./address";
import { useCode } from "./context";
import { isImage, isMarkdown, isSvg, lfsOf, SHOW_MAX, textQuery } from "./data";
import { Prose } from "./Prose";
import { State } from "./State";

export type Look = "preview" | "source";

function GitHubButton({ path }: { path: string }) {
  const { git, head } = useCode();
  return <Button label="Open on GitHub" variant="secondary" size="sm" icon={<Icon icon={ExternalLink} size="sm" />} href={`${git.github}/blob/${head}/${rawPath(path)}`} target="_blank" rel="noopener noreferrer" />;
}

function RawButton({ path, sha }: { path: string; sha: string }) {
  const { git, raw } = useCode();
  return <Button label="Raw" variant="ghost" size="sm" href={raw ? `${raw}${rawPath(path)}` : git.rawUrl(sha)} target="_blank" rel="noopener noreferrer" />;
}

/** The file's lines while its text is on its way, laid out as the text will be. */
export function TextSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-2" role="status" aria-busy="true" aria-label="Loading the file">
      {Array.from({ length: 32 }, (_, i) => (
        <div key={i} className="flex items-center" style={{ height: LINE_HEIGHT }}>
          <span className="w-12 flex-none" />
          <Skeleton height={10} width={`${(i * 37) % 9 === 0 ? 0 : 18 + ((i * 41) % 58)}%`} radius={1} index={i % 6} />
        </div>
      ))}
    </div>
  );
}

function Gone({ path }: { path: string }) {
  const { tree, head, open, href } = useCode();
  const near = useMemo(() => (tree ? find(tree.paths, nameOf(path), 5).map((i) => tree.paths[i] ?? "") : []), [tree, path]);
  return (
    <State
      icon={FileQuestion}
      title={
        <>
          There is no <code className="mono">{path}</code> at <code className="mono">{head.slice(0, 7)}</code>
        </>
      }
      actions={<Button label="Open the top of the repository" variant="secondary" size="sm" onClick={() => open("")} />}
    >
      <p className="m-0">It may have moved or been deleted since the link was made.</p>
      {near.length > 0 && (
        <div className="mt-3 flex flex-col items-center gap-1">
          <span className="type-micro">Files with a name like it</span>
          <ul className="m-0 flex list-none flex-col items-center gap-0.5 p-0">
            {near.map((p) => (
              <li key={p}>
                <A
                  href={href(p)}
                  onClick={(e) => {
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    open(p);
                  }}
                  className="mono inline-link text-sm"
                >
                  {p}
                </A>
              </li>
            ))}
          </ul>
        </div>
      )}
    </State>
  );
}

function Picture({ src, alt }: { src: string; alt: string }) {
  const [size, setSize] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  if (failed) return <State icon={FileWarning} title="The picture could not be loaded" />;
  return (
    <figure className="m-0 flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto p-6">
      <div className="grid max-h-full max-w-full place-items-center rounded-md border border-line bg-surface bg-(image:--dots) bg-size-[12px_12px] p-4" style={{ colorScheme: "light" }}>
        <img
          src={src}
          alt={alt}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(e) => setSize(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} px`)}
          onError={() => setFailed(true)}
          className="block h-auto max-h-[min(60dvh,40rem)] max-w-full object-contain"
        />
      </div>
      <figcaption className="h-4 type-micro tnum">{size ?? ""}</figcaption>
    </figure>
  );
}

function SvgPicture({ text, alt }: { text: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const made = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [text]);
  return url ? <Picture src={url} alt={alt} /> : <TextSkeleton />;
}

/** A file at HEAD in the window: its text with syntax colours, Markdown as prose, a picture, or a plain account of why there is nothing to read here. */
export function FileBody({ story, path, line, wrap, look, onLine }: { story: CodeStory | undefined; path: string; line: number | undefined; wrap: boolean; look: Look; onLine: (n: number | undefined) => void }) {
  const ctx = useCode();
  const file = story?.kind === "file" ? story.file : null;
  const raw = story?.raw ?? ctx.raw;
  const limit = raw ? SHOW_MAX : FILE_BYTES_MAX;
  const binary = !!file && (file.flags & FILE_BINARY) !== 0;
  const big = !!file && !binary && file.bytes > limit;
  const wanted = !!file && !binary && !big;
  const text = useQuery({ ...textQuery(ctx.git, raw, path, file?.sha ?? ""), enabled: wanted });
  if (!story) return <TextSkeleton />;
  if (story.kind === "missing" || !file) return <Gone path={path} />;
  if (binary) {
    if (isImage(path) && raw) return <Picture src={`${raw}${rawPath(path)}`} alt={nameOf(path)} />;
    return (
      <State icon={Binary} title={`A binary file of ${bytes(file.bytes)}`} actions={<GitHubButton path={path} />}>
        It holds no text to read here.
      </State>
    );
  }
  if (big)
    return (
      <State
        icon={Scale}
        title={`Too large to show here: ${bytes(file.bytes)}`}
        actions={
          <>
            <RawButton path={path} sha={file.sha} />
            <GitHubButton path={path} />
          </>
        }
      >
        The window reads files up to {bytes(limit)}. Its {file.lines > 0 ? `${file.lines.toLocaleString("en-US")} lines are` : "text is"} on GitHub.
      </State>
    );
  if (text.isError)
    return (
      <State icon={FileWarning} title="The file's text could not be read" actions={<><Button label="Try again" variant="secondary" size="sm" icon={<Icon icon={RefreshCw} size="sm" />} onClick={() => void text.refetch()} /><GitHubButton path={path} /></>}>
        {text.error instanceof Error ? text.error.message : "Neither GitHub nor the Site answered."}
      </State>
    );
  if (text.data === undefined) return <TextSkeleton />;
  const lfs = lfsOf(text.data);
  if (lfs)
    return (
      <State icon={PackageOpen} title="Stored with Git LFS" actions={<GitHubButton path={path} />}>
        The repository holds a pointer to a file of {bytes(lfs.size)}, kept outside git. <span className="mono break-all">sha256 {lfs.oid.slice(0, 12)}…</span>
      </State>
    );
  if ((file.flags & FILE_LINK) !== 0) {
    const target = repoPathOf(path, text.data.trim());
    return (
      <State icon={Link2} title="A symbolic link" actions={target !== null ? <Button label={`Open ${target}`} variant="secondary" size="sm" onClick={() => ctx.open(target)} /> : undefined}>
        It points to <code className="mono">{text.data.trim()}</code>.
      </State>
    );
  }
  if (text.data === "")
    return (
      <State icon={Files} title="This file is empty">
        It has no text at <code className="mono">{ctx.head.slice(0, 7)}</code>.
      </State>
    );
  if (look === "preview" && line === undefined && isMarkdown(file.lang))
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <article className="mx-auto max-w-3xl px-6 py-6 md:px-10 md:py-8">
          <Prose text={text.data} from={path} />
        </article>
      </div>
    );
  if (look === "preview" && line === undefined && isSvg(path)) return <SvgPicture text={text.data} alt={nameOf(path)} />;
  return <CodeView key={file.sha} text={text.data} lang={file.lang} line={line} onLine={onLine} wrap={wrap} lineHref={(n) => ctx.href(path, n)} label={`${nameOf(path)}, its text`} />;
}
