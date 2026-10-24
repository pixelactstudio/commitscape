import { useEffect, useState, type ReactNode } from "react";

export type ProfilePart = { id: string; label: string };

const OFFSET = "scroll-mt-[calc(var(--chrome-top)+3.5rem)]";

/** A part of a long page a link can jump to, clear of the sticky bars. */
export function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className={OFFSET}>
      {children}
    </div>
  );
}

function useParts(parts: ProfilePart[]): { current: string; shown: Set<string> } {
  const [current, setCurrent] = useState(parts[0]?.id ?? "");
  const [shown, setShown] = useState(() => new Set(parts.map((p) => p.id)));
  useEffect(() => {
    const els = parts.map((p) => document.getElementById(p.id)).filter((e): e is HTMLElement => !!e);
    const seen = new Map<string, boolean>();
    const watch = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = parts.find((p) => seen.get(p.id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    const size = new ResizeObserver(() => setShown(new Set(els.filter((e) => e.offsetHeight > 0).map((e) => e.id))));
    for (const el of els) {
      watch.observe(el);
      size.observe(el);
    }
    return () => {
      watch.disconnect();
      size.disconnect();
    };
  }, [parts]);
  return { current, shown };
}

/** The parts of a long Profile as links under the header, the one in view marked; parts that have nothing to show are left out. */
export function ProfileNav({ parts }: { parts: ProfilePart[] }) {
  const { current, shown } = useParts(parts);
  return (
    <nav aria-label="On this page" className="sticky top-(--header-height) z-(--z-sticky) border-b border-separator bg-body">
      <ul className="m-0 flex list-none gap-1 overflow-x-auto px-(--frame-inset) py-0 [scrollbar-width:none]">
        {parts
          .filter((p) => shown.has(p.id))
          .map((p) => (
            <li key={p.id} className="flex-none">
              <a
                href={`#${p.id}`}
                aria-current={current === p.id ? "location" : undefined}
                className={`row-hover relative my-1 inline-flex h-8 items-center rounded-md px-2.5 type-label whitespace-nowrap no-underline after:absolute after:inset-x-2.5 after:-bottom-1 after:h-0.5 after:rounded-full after:content-[''] ${current === p.id ? "text-primary after:bg-brand" : "text-secondary hover:text-primary"}`}
              >
                {p.label}
              </a>
            </li>
          ))}
      </ul>
    </nav>
  );
}
