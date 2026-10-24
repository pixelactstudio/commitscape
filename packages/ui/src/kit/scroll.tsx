import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const FADE = "2rem";
const MASKS = {
  end: `linear-gradient(to right, black calc(100% - ${FADE}), transparent)`,
  start: `linear-gradient(to right, transparent, black ${FADE})`,
  both: `linear-gradient(to right, transparent, black ${FADE}, black calc(100% - ${FADE}), transparent)`,
};

/** A row that scrolls sideways when it does not fit, fading out at each edge that has more beyond it, so nothing is hidden without a cue. */
export function ScrollRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });
  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const left = Math.abs(el.scrollLeft);
    const next = { start: left > 1, end: el.scrollWidth - el.clientWidth - left > 1 };
    setMore((m) => (m.start === next.start && m.end === next.end ? m : next));
  }, []);
  useEffect(() => {
    measure();
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    if (el.firstElementChild) watch.observe(el.firstElementChild);
    return () => watch.disconnect();
  }, [measure]);
  const mask = more.start && more.end ? MASKS.both : more.end ? MASKS.end : more.start ? MASKS.start : undefined;
  return (
    <div ref={box} onScroll={measure} className={`max-w-full overflow-x-auto [scrollbar-width:none] ${className}`} style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}>
      {children}
    </div>
  );
}
