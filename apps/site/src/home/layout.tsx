import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
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

/** A section's centred heading that blurs into view: a small labelled chip, the title and a line of explanation. */
export function Heading({ icon: Glyph, eyebrow, title, words }: { icon: LucideIcon; eyebrow: string; title: ReactNode; words: string }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-5 text-center">
      <Reveal blur={false} y={0}>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--color-background-surface)] px-3 py-1 text-[0.78rem] font-medium text-secondary">
          <Glyph size={13} className="text-brand" aria-hidden />
          {eyebrow}
        </span>
      </Reveal>
      <Reveal as="h2" delay={STAGGER.base} className="m-0 text-[clamp(1.85rem,4vw,2.9rem)] leading-[1.06] font-semibold tracking-[-0.04em] text-balance">
        {title}
      </Reveal>
      <Reveal as="p" delay={STAGGER.loose} className="m-0 max-w-xl text-[1.02rem] leading-relaxed text-pretty text-secondary">
        {words}
      </Reveal>
    </div>
  );
}
