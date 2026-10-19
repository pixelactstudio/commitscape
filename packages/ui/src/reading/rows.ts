import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

export type RowWindow = { from: number; to: number; before: number; after: number };

/** The rows of a long table that are near the screen, and the height of the rows above and below them: a page of thousands draws a few dozen. Each row is `size` pixels tall; `reset` changes when the rows are a different set, and the page scrolls back to the table's top if it is below it. */
export function useWindowRows(count: number, size: number, reset: string, overscan = 12): [RefObject<HTMLTableSectionElement | null>, RowWindow] {
  const body = useRef<HTMLTableSectionElement | null>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const read = () => {
      const top = body.current ? body.current.getBoundingClientRect().top + window.scrollY : 0;
      setMargin((m) => (Math.abs(m - top) < 1 ? m : top));
    };
    read();
    const watch = new ResizeObserver(read);
    watch.observe(document.body);
    return () => watch.disconnect();
  }, []);
  const virtual = useWindowVirtualizer({ count, estimateSize: () => size, overscan, scrollMargin: margin, initialRect: { width: 1024, height: 900 } });
  const seen = useRef(reset);
  useEffect(() => {
    if (seen.current === reset) return;
    seen.current = reset;
    const top = body.current ? body.current.getBoundingClientRect().top + window.scrollY : 0;
    const bar = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top - bar - size) });
  }, [reset, size]);
  const items = virtual.getVirtualItems();
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return [body, { from: 0, to: 0, before: 0, after: 0 }];
  return [body, { from: first.index, to: last.index + 1, before: first.start - margin, after: Math.max(0, virtual.getTotalSize() - (last.end - margin)) }];
}

