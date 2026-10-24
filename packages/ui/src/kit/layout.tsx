import type { ReactNode } from "react";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Skeleton } from "@astryxdesign/core/Skeleton";

export { Chip, Pill } from "./primitives";

const WIDTHS = { default: "px-(--frame-inset)", narrow: "mx-auto max-w-[calc(var(--page-narrow)+2*var(--gutter))] px-(--gutter)" } as const;

/** A page's column: on the frame's edges, the same as the top bar and the footer, or a narrower centred one for reading. */
export function Page({ children, width = "default", className = "" }: { children: ReactNode; width?: keyof typeof WIDTHS; className?: string }) {
  return <div className={`w-full ${WIDTHS[width]} ${className}`}>{children}</div>;
}

/** A page's title block: what it is, a line about it, and what can be done from it. */
export function PageHead({ eyebrow, title, description, actions, media }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; media?: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 pt-page-top pb-6 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
        {media}
        <div className="flex min-w-0 flex-col gap-1.5">
          {eyebrow && <div className="type-label text-secondary">{eyebrow}</div>}
          <Heading level={1} textWrap="balance">
            <span className="block type-page">{title}</span>
          </Heading>
          {description && <p className="m-0 max-w-2xl type-lead">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** One section of a page: a titled surface with an explanation and its own actions. */
export function Panel({ title, description, actions, children, id, className = "", padding = 5, bare = false }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string; className?: string; padding?: 0 | 4 | 5 | 6; bare?: boolean }) {
  const head = (title || actions) && (
    <div className={`flex flex-col items-start gap-x-6 gap-y-3 sm:flex-row sm:justify-between ${padding === 0 ? "px-5 pt-5" : ""}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && (
          <Heading level={2}>
            <span className="block type-panel">{title}</span>
          </Heading>
        )}
        {description && <div className="type-description">{description}</div>}
      </div>
      {actions && <div className="flex max-w-full flex-none flex-wrap items-center gap-2 max-sm:self-stretch">{actions}</div>}
    </div>
  );
  if (bare)
    return (
      <section id={id} aria-label={typeof title === "string" ? title : undefined} className={`flex min-w-0 scroll-mt-(--chrome-top) flex-col gap-stack ${className}`}>
        {head}
        {children}
      </section>
    );
  return (
    <section id={id} aria-label={typeof title === "string" ? title : undefined} className={`min-w-0 scroll-mt-(--chrome-top) ${className}`}>
      <Card padding={padding}>
        <div className="flex min-w-0 flex-col gap-stack">
          {head}
          {children}
        </div>
      </Card>
    </section>
  );
}

/** A Panel's stand-in while its data streams in, the same size as what will replace it. */
export function PanelSkeleton({ title, height, className = "" }: { title?: string; height: number; className?: string }) {
  return (
    <Panel title={title} description={<Skeleton height={13} width={220} radius={1} />} className={className}>
      <Skeleton height={height} />
    </Panel>
  );
}

/** A number with what it counts beneath it; the large ones lead a page. */
export function Stat({ value, label, note, size = "md", tone, children }: { value: ReactNode; label: ReactNode; note?: ReactNode; size?: "lg" | "md" | "sm"; tone?: "brand"; children?: ReactNode }) {
  const big = size === "lg" ? "type-stat-lg" : size === "md" ? "type-stat" : "type-stat-sm";
  return (
    <div role="group" aria-label={typeof label === "string" ? label : undefined} className="flex min-w-0 flex-col gap-1">
      <span className={`${big} ${tone === "brand" ? "text-brand" : "text-primary"}`}>{value}</span>
      <span className="mt-1 type-label">{label}</span>
      {note && <span className="type-caption">{note}</span>}
      {children}
    </div>
  );
}

/** A thin bar showing how much of a whole something is. */
export function Meter({ value, label, tone = "brand", className = "" }: { value: number; label: string; tone?: "brand" | "neutral" | "added"; className?: string }) {
  const colour = tone === "brand" ? "bg-brand" : tone === "added" ? "bg-added" : "bg-secondary";
  return (
    <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} className={`block h-1.5 w-full overflow-hidden rounded-full bg-track ${className}`}>
      <span className={`block h-full rounded-full ${colour}`} style={{ width: `${Math.max(value > 0 ? 2 : 0, Math.min(100, value * 100))}%` }} />
    </span>
  );
}

/** Lines added and removed side by side, as a split bar. */
export function AddedRemoved({ added, removed, className = "" }: { added: number; removed: number; className?: string }) {
  const all = Math.max(1, added + removed);
  return (
    <span aria-hidden className={`flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full ${className}`}>
      <span className="block h-full rounded-s-full bg-added" style={{ width: `${(added * 100) / all}%` }} />
      <span className="block h-full flex-1 rounded-e-full bg-removed" />
    </span>
  );
}

/** A coloured dot for a programming language, as GitHub colours it. */
export function LangDot({ colour }: { colour: string | null }) {
  return <span aria-hidden className="inline-block size-2.5 flex-none rounded-full" style={{ background: colour ?? "var(--other)" }} />;
}

/** The short uppercase line above a heading that says what kind of thing follows. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`type-eyebrow ${className}`}>{children}</span>;
}
