import type { ButtonHTMLAttributes, ReactNode } from "react";
import { A } from "./A";

/** The one bordered box for content that is not a titled Panel: rounded, hairline-edged, on the surface colour. */
export function Surface({ as = "div", padded = false, className = "", children, ...rest }: { as?: "div" | "section" | "article" | "li" | "ul" | "ol"; padded?: boolean; className?: string; children: ReactNode; id?: string; "aria-label"?: string; role?: string }) {
  const Tag = as as "div";
  return (
    <Tag className={`surface ${padded ? "p-panel" : ""} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

type Plain = ButtonHTMLAttributes<HTMLButtonElement> & { pressable?: boolean };

/** A button with no chrome of its own, for text, icons or a whole region that act. */
export function PlainButton({ className = "", pressable = false, type = "button", ...rest }: Plain) {
  return <button type={type} className={`plain-button ${pressable ? "press" : ""} ${className}`} {...rest} />;
}

/** A full-width row that acts, with the one row hover. */
export function RowButton({ className = "", type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={`plain-button row-hover flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-start ${className}`} {...rest} />;
}

const PILL_TONES = {
  neutral: "border-line bg-surface text-secondary",
  strong: "border-line bg-surface text-primary",
  brand: "border-brand-line bg-brand-soft text-brand",
  quiet: "border-transparent bg-sunken text-secondary",
  warning: "border-yellow-ring bg-yellow-subtle text-yellow-vivid",
} as const;

export type PillTone = keyof typeof PILL_TONES;

/** A small rounded label: a status, a fact or a tag, always one size. */
export function Pill({ children, icon, tone = "neutral", title, className = "" }: { children: ReactNode; icon?: ReactNode; tone?: PillTone; title?: string; className?: string }) {
  return (
    <span title={title} className={`inline-flex h-6 max-w-full flex-none items-center gap-1.5 rounded-full border px-2.5 text-sm font-medium whitespace-nowrap ${PILL_TONES[tone]} ${className}`}>
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export const Chip = Pill;

/** A link inside running text: underlined in the line colour, the full ink on hover. */
export function InlineLink({ href, onClick, children, className = "", external = false }: { href?: string; onClick?: () => void; children: ReactNode; className?: string; external?: boolean }) {
  if (href) return <A href={href} className={`inline-link ${className}`} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</A>;
  return (
    <button type="button" onClick={onClick} className={`plain-button inline-link ${className}`}>
      {children}
    </button>
  );
}

/** A plain line saying there is nothing to show, and why. */
export function Quiet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`m-0 py-6 text-center type-caption text-pretty ${className}`}>{children}</p>;
}

/** A workspace screen's one-line header: its title, what it counts, and its own actions at the end, set below the top bar by the same space on every screen. */
export function ScreenHeader({ title, counts, actions, id }: { title: ReactNode; counts?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="pt-3 sm:pt-4">
      <div className="flex min-h-(--screen-header-height) flex-wrap items-center gap-x-4 gap-y-2 border-b border-separator py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 id={id} tabIndex={-1} className="m-0 type-title outline-offset-4">
            {title}
          </h1>
          {counts && <p className="m-0 min-w-0 type-description">{counts}</p>}
        </div>
        {actions && <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
