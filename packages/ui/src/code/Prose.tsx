import { useMemo, type ReactNode } from "react";
import { Markdown, type MarkdownComponents } from "@astryxdesign/core/Markdown";
import { rawPath } from "@commitscape/data";
import { A } from "../kit/A";
import { repoPathOf } from "./address";
import { plainMarkdown } from "./markdown";
import { useCode } from "./context";

function Link({ from, href, children }: { from: string; href: string; children: ReactNode }) {
  const { open, href: hrefOf } = useCode();
  const inside = repoPathOf(from, href);
  if (inside !== null)
    return (
      <A
        href={hrefOf(inside)}
        className="inline-link"
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          open(inside);
        }}
      >
        {children}
      </A>
    );
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-link">
      {children}
    </a>
  );
}

/** A Markdown file of the repository drawn as prose: links inside the repository open in the Code window, pictures load from the repository at HEAD. */
export function Prose({ text, from }: { text: string; from: string }) {
  const { raw } = useCode();
  const source = useMemo(() => plainMarkdown(text), [text]);
  const components = useMemo<Partial<MarkdownComponents>>(
    () => ({
      link: ({ href, children }) => (
        <Link from={from} href={href}>
          {children}
        </Link>
      ),
      image: ({ src, alt }) => {
        const inside = repoPathOf(from, src);
        const url = inside === null ? (/^https:\/\//.test(src) ? src : null) : raw ? `${raw}${rawPath(inside)}` : null;
        if (!url) return alt ? <span className="type-caption">[{alt}]</span> : null;
        return <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="inline-block h-auto max-w-full align-middle" />;
      },
    }),
    [from, raw],
  );
  return (
    <div className="min-w-0 type-body text-primary">
      <Markdown headingLevelStart={3} components={components} autolink="gfm">
        {source}
      </Markdown>
    </div>
  );
}
