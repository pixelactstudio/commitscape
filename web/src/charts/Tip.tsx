/**
 * The hover layer every chart has: a tooltip that follows the pointer, and
 * the same text on focus for the keyboard.
 */
import { useState, type ReactNode } from "react";
import { TipContext, type Show } from "./tip";

type Tip = { x: number; y: number; content: ReactNode } | null;

export function TipLayer({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip>(null);
  const show: Show = (e, content) => setTip({ x: e.clientX, y: e.clientY, content });
  const hide = () => setTip(null);
  return (
    <TipContext.Provider value={{ show, hide }}>
      {children}
      {tip && (
        <div
          className="tip"
          role="tooltip"
          style={{
            left: Math.min(tip.x + 14, window.innerWidth - 280),
            top: tip.y + 14 > window.innerHeight - 120 ? tip.y - 90 : tip.y + 14,
          }}
        >
          {tip.content}
        </div>
      )}
    </TipContext.Provider>
  );
}
