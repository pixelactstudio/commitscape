import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Icon } from "@astryxdesign/core/Icon";
import { Tab, TabList } from "@astryxdesign/core/TabList";
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

/** Everything a styled Card can be taken out as: README Markdown, its addresses, a post, and PNGs. */
export function Outputs({ choice, query, origin }: { choice: CardChoice; query: string; origin: string }) {
  const [tab, setTab] = useState("readme");
  const a = useAddresses(choice, query, origin);
  return (
    <section aria-label="Use it" className="flex flex-col gap-stack rounded-lg border border-line bg-surface p-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 type-panel">Use it</h2>
        <TabList value={tab} onChange={setTab} size="sm" role="tablist">
          <Tab value="readme" panelId="studio-output" label="README" />
          <Tab value="links" panelId="studio-output" label="Links" />
          <Tab value="post" panelId="studio-output" label="Post it" />
        </TabList>
      </div>
      <div id="studio-output" role="tabpanel" className="flex min-w-0 flex-col gap-3">
        {tab === "readme" && (
          <>
            <p className="m-0 type-description">Paste it into a README. GitHub shows the dark Card to readers in dark mode, animated, and it refreshes every six hours.</p>
            <CodeBlock code={a.markdown} language="html" width="100%" size="sm" isWrapped onCopy={() => a.toast("Markdown copied")} />
            <Button label="Copy the Markdown" variant="primary" width="100%" icon={<Icon icon={Copy} size="sm" />} onClick={() => a.copy(a.markdown, "Markdown copied")} />
          </>
        )}
        {tab === "links" && (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {[
              ["The page it links to", a.link],
              ["The Card, light", a.image("svg", "light")],
              ["The Card, dark", a.image("svg", "dark")],
              ["As a PNG", a.image("png", "light")],
            ].map(([label, link]) => (
              <li key={label} className="flex min-w-0 flex-col gap-1">
                <span className="type-caption">{label}</span>
                <div className="flex min-w-0 items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate rounded-sm border border-line bg-sunken px-2 py-1.5 text-2xs">{link}</code>
                  <Button label={`Copy: ${label}`} isIconOnly size="sm" variant="ghost" icon={<Icon icon={Link2} size="sm" />} onClick={() => a.copy(link ?? "", "Link copied")} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {tab === "post" && (
          <>
            <p className="m-0 type-description">The post links to the page, and X and LinkedIn show its preview image. Download the PNG to attach the Card itself.</p>
            <blockquote className="m-0 rounded-md border border-line bg-sunken px-3 py-2 type-body text-primary">
              {choice.share} <span className="text-secondary">{a.link}</span>
            </blockquote>
            <div className="flex flex-wrap gap-2">
              <Button label="Post on X" variant="primary" href={a.x} target="_blank" rel="noopener noreferrer" />
              <Button label="Share on LinkedIn" variant="secondary" href={a.linkedin} target="_blank" rel="noopener noreferrer" />
              <Button label="Copy text and link" variant="ghost" icon={<Icon icon={Copy} size="sm" />} onClick={() => a.copy(`${choice.share} ${a.link}`, "Copied")} />
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-stack">
        <span className="me-auto type-label">As an image</span>
        <Button label="PNG, light" size="sm" variant="secondary" icon={<Icon icon={Download} size="sm" />} href={a.png("light")} target="_blank" />
        <Button label="PNG, dark" size="sm" variant="secondary" icon={<Icon icon={Download} size="sm" />} href={a.png("dark")} target="_blank" />
      </div>
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
