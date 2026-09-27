import { useCallback, useRef, useState } from "react";

export function useWidth<T extends Element>(): [(el: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    observer.current = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.current.observe(el);
  }, []);
  return [ref, width];
}

export function ticks(max: number, count = 3): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const size = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * size).find((s) => s >= raw) ?? raw);
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1000) / 1000);
  if ((out.at(-1) ?? 0) < max) out.push((out.at(-1) ?? 0) + step);
  return out;
}

export function ranges(bounds: number[]): { step: number; from: number; to: number }[] {
  const out = [];
  let from = 1;
  for (const [i, to] of bounds.entries()) {
    if (to >= from) out.push({ step: i + 1, from, to });
    from = Math.max(from, to + 1);
  }
  return out;
}
