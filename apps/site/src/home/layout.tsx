import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Chip } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { Reveal, STAGGER } from "@commitscape/ui/motion";

/** The home page's frame: a centred column ruled on both sides that every band sits in. */
export function Rails({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[var(--page)] border-line sm:border-x">{children}</div>;
}

/** One band of the home page, ruled above, with a cross where the rule meets each side. */
export function Band({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={`band relative border-t border-line ${className}`}>
      <span aria-hidden className="cross -start-[6px]" />
      <span aria-hidden className="cross -end-[6px]" />
      {children}
    </section>
  );
}

/** The small labelled chip above a home section's title. */
export function Kicker({ icon: Glyph, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <Chip icon={<Glyph size={ICON.xs} className="text-brand" aria-hidden />} className="text-secondary!">
      {children}
    </Chip>
  );
}

/** A section's centred heading that blurs into view: a small labelled chip, the title and a line of explanation. */
export function Heading({ icon, eyebrow, title, words }: { icon: LucideIcon; eyebrow: string; title: ReactNode; words: string }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-5 text-center">
      <Reveal blur={false} y={0}>
        <Kicker icon={icon}>{eyebrow}</Kicker>
      </Reveal>
      <Reveal as="h2" delay={STAGGER.base} className="m-0 type-display">
        {title}
      </Reveal>
      <Reveal as="p" delay={STAGGER.loose} className="m-0 max-w-xl type-lead">
        {words}
      </Reveal>
    </div>
  );
}
