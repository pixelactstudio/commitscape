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
          className="pointer-events-none fixed z-[1000] max-w-[270px] rounded-[var(--radius-element)] border border-line bg-popover px-2.5 py-2 text-[0.8rem] break-words text-primary shadow-[var(--shadow-med)] [&_.note]:text-secondary"
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
