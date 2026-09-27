import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Calls `fn` at once for the first call, then at most every `ms` with the
 * latest value while calls keep coming: the first keystroke searches
 * straight away, a burst of them once more at the end (npmx.dev's
 * leading-edge debounce).
 */
export function useLeading<T>(fn: (value: T) => void, ms: number): (value: T) => void {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  const state = useRef<{ timer: ReturnType<typeof setTimeout> | null; pending: { value: T } | null }>({
    timer: null,
    pending: null,
  });
  useEffect(
    () => () => {
      if (state.current.timer) clearTimeout(state.current.timer);
    },
    [],
  );
  return useCallback(
    (value: T) => {
      const s = state.current;
      if (s.timer) {
        s.pending = { value };
        return;
      }
      latest.current(value);
      const tick = () => {
        const next = s.pending;
        s.pending = null;
        if (!next) {
          s.timer = null;
          return;
        }
        latest.current(next.value);
        s.timer = setTimeout(tick, ms);
      };
      s.timer = setTimeout(tick, ms);
    },
    [ms],
  );
}
