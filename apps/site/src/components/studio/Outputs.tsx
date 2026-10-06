import type { ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Icon } from "@astryxdesign/core/Icon";
import { ChevronRight, Copy, Download, Link2 } from "lucide-react";
import { ICON } from "@commitscape/ui/design";
import { cardSrc, markdownOf } from "#/lib/markdown";
import { useToast } from "#/lib/toast";
import type { CardChoice } from "./types";

function useAddresses(choice: CardChoice, query: string, origin: string) {
  const toast = useToast();
  const absolute = (u: string) => (u.startsWith("http") ? u : `${origin}${u}`);
  const url = absolute(choice.url);
  const link = absolute(choice.link);
  return {
    link,
    markdown: markdownOf(url, choice.alt, link, query),
    image: (format: "svg" | "png", theme: "light" | "dark") => absolute(cardSrc(choice.url, format, theme, query)),
    png: (theme: "light" | "dark") => cardSrc(choice.url, "png", theme, query),
    x: `https://x.com/intent/post?text=${encodeURIComponent(choice.share)}&url=${encodeURIComponent(link)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`,
    copy: (text: string, words: string) => void navigator.clipboard?.writeText(text).then(() => toast(words)),
    toast,
  };
}

/** Everything a styled Card can be taken out as, side by side: README Markdown, PNG downloads, a post, and its addresses. */
export function Outputs({ choice, query, origin }: { choice: CardChoice; query: string; origin: string }) {
  const a = useAddresses(choice, query, origin);
  const file = choice.id.replace(/[^a-z0-9]+/gi, "-");
  return (
    <section aria-labelledby="studio-use" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="studio-use" className="m-0 type-heading">
          Use it
        </h2>
        <p className="m-0 type-description">Everything here carries the style you picked, so it looks the way it does above.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Block title="In a README" words="GitHub shows the dark Card to readers in dark mode, animated, and it refreshes every six hours." className="lg:col-span-2">
          <CodeBlock code={a.markdown} language="html" width="100%" size="sm" isWrapped onCopy={() => a.toast("Markdown copied")} />
          <div className="mt-auto flex flex-wrap gap-2">
            <Button label="Copy the Markdown" variant="primary" icon={<Icon icon={Copy} size="sm" />} onClick={() => a.copy(a.markdown, "Markdown copied")} />
          </div>
        </Block>
        <Block title="As an image" words="A still PNG, for a slide, a document or a post.">
          <div className="grid flex-1 grid-cols-2 gap-2">
            {(["light", "dark"] as const).map((theme) => (
              <a key={theme} href={a.png(theme)} download={`${file}-${theme}.png`} aria-label={`PNG, ${theme}`} data-mode={theme} className="studio-download group/dl flex min-h-36 flex-col justify-between gap-3 rounded-lg p-3 no-underline">
                <span className="grid flex-1 place-items-center">
                  <img src={cardSrc(choice.url, "svg", theme, query)} alt="" loading="lazy" className="max-h-32 w-full object-contain drop-shadow-md transition-transform duration-(--duration-base) ease-(--ease-out) group-hover/dl:-translate-y-0.5" />
                </span>
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {theme === "light" ? "Light" : "Dark"}
                  <Download size={ICON.sm} aria-hidden />
                </span>
              </a>
            ))}
          </div>
        </Block>
        <Block title="In a post" words="The post links to the page, and X and LinkedIn show its preview image. Attach the PNG to post the Card itself.">
          <div className="flex flex-col gap-1 rounded-lg border border-line bg-sunken px-4 py-3">
            <p className="m-0 type-body text-primary">{choice.share}</p>
            <p className="m-0 truncate text-sm text-brand">{a.link}</p>
          </div>
          <div className="mt-auto flex flex-wrap gap-2">
            <Button label="Post on X" variant="primary" href={a.x} target="_blank" rel="noopener noreferrer" />
            <Button label="Share on LinkedIn" variant="secondary" href={a.linkedin} target="_blank" rel="noopener noreferrer" />
            <Button label="Copy text and link" variant="ghost" isIconOnly icon={<Icon icon={Copy} size="sm" />} onClick={() => a.copy(`${choice.share} ${a.link}`, "Copied")} />
          </div>
        </Block>
        <Block title="Its addresses" words="To put the Card anywhere an image goes, or to link to the page behind it." className="lg:col-span-2">
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {[
              ["The page", a.link],
              ["The Card, light", a.image("svg", "light")],
              ["The Card, dark", a.image("svg", "dark")],
              ["As a PNG", a.image("png", "light")],
            ].map(([label, link]) => (
              <li key={label} className="grid min-w-0 items-center gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
                <span className="type-label">{label}</span>
                <code className="min-w-0 truncate font-mono text-xs text-secondary">{link}</code>
                <Button label={`Copy: ${label}`} isIconOnly size="sm" variant="ghost" icon={<Icon icon={Link2} size="sm" />} onClick={() => a.copy(link ?? "", "Link copied")} className="hidden sm:inline-flex" />
              </li>
            ))}
          </ul>
        </Block>
      </div>
    </section>
  );
}

function Block({ title, words, className = "", children }: { title: string; words: string; className?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={`flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-surface p-5 ${className}`}>
      <div className="flex flex-col gap-1">
        <h3 className="m-0 type-panel">{title}</h3>
        <p className="m-0 type-description">{words}</p>
      </div>
      {children}
    </section>
  );
}

/** The few ways out a Share dialog needs: copy for a README, copy the link, post it, download it. */
export function QuickOutputs({ choice, query, origin }: { choice: CardChoice; query: string; origin: string }) {
  const a = useAddresses(choice, query, origin);
  return (
    <div className="flex flex-col gap-2">
      <Button label="Copy for a README" variant="primary" width="100%" icon={<Icon icon={Copy} size="sm" />} onClick={() => a.copy(a.markdown, "Markdown copied")} />
      <div className="grid grid-cols-2 gap-2">
        <Button label="Copy link" variant="secondary" width="100%" icon={<Icon icon={Link2} size="sm" />} onClick={() => a.copy(a.link, "Link copied")} />
        <Button label="Post on X" variant="secondary" width="100%" href={a.x} target="_blank" rel="noopener noreferrer" />
        <Button label="PNG, light" variant="secondary" width="100%" icon={<Icon icon={Download} size="sm" />} href={a.png("light")} target="_blank" />
        <Button label="PNG, dark" variant="secondary" width="100%" icon={<Icon icon={Download} size="sm" />} href={a.png("dark")} target="_blank" />
      </div>
      <Button label="Share on LinkedIn" variant="ghost" width="100%" href={a.linkedin} target="_blank" rel="noopener noreferrer" />
      <details className="group rounded-md border border-line">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 type-label [&::-webkit-details-marker]:hidden">
          <ChevronRight size={ICON.sm} aria-hidden className="transition-transform duration-(--duration-fast) group-open:rotate-90" />
          See the Markdown
        </summary>
        <div className="border-t border-line p-2">
          <CodeBlock code={a.markdown} language="html" width="100%" size="sm" isWrapped onCopy={() => a.toast("Markdown copied")} />
        </div>
      </details>
    </div>
  );
}
