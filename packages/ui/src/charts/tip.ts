import { createContext, useContext, type ReactNode } from "react";

export type Show = (e: { clientX: number; clientY: number }, content: ReactNode) => void;

export const TipContext = createContext<{ show: Show; hide: () => void }>({
  show: () => {},
  hide: () => {},
});

/**
 * What to spread on a mark for its tooltip: on hover, and on focus from
 * the element's own position.
 */
export function useTip() {
  const { show, hide } = useContext(TipContext);
  return (content: ReactNode) => ({
    onMouseMove: (e: React.MouseEvent) => show(e, content),
    onMouseLeave: hide,
    onFocus: (e: React.FocusEvent<Element>) => {
      const r = e.currentTarget.getBoundingClientRect();
      show({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, content);
    },
    onBlur: hide,
  });
}
