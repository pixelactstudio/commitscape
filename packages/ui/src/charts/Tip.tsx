import { isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MousePointerClick } from "lucide-react";
import { Face } from "../components/Face";
import { ICON } from "../design/tokens";
import { TipContext, type Show } from "./tip";

type Tip = { x: number; y: number; content: ReactNode } | null;

const GAP = 14;
const EDGE = 8;

/** Holds the one tooltip every chart on the page shares: it follows the pointer and flips to stay inside the window. */
export function TipLayer({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip>(null);
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const show: Show = (e, content) => setTip({ x: e.clientX, y: e.clientY, content });
  const hide = () => {
    setTip(null);
    setAt(null);
  };
  useEffect(() => {
    const away = () => {
      setTip(null);
      setAt(null);
    };
    window.addEventListener("click", away, true);
    window.addEventListener("scroll", away, { passive: true });
    return () => {
      window.removeEventListener("click", away, true);
      window.removeEventListener("scroll", away);
    };
  }, []);
  useLayoutEffect(() => {
    const el = box.current;
    if (!tip || !el) return;
    const { width, height } = el.getBoundingClientRect();
    const right = tip.x + GAP + width > window.innerWidth - EDGE;
    const below = tip.y + GAP + height <= window.innerHeight - EDGE;
    setAt({
      left: Math.max(EDGE, right ? tip.x - GAP - width : tip.x + GAP),
      top: Math.max(EDGE, below ? tip.y + GAP : tip.y - GAP - height),
    });
  }, [tip]);
  const card = isValidElement(tip?.content) && tip?.content.type === TipCard;
  return (
    <TipContext.Provider value={{ show, hide }}>
      {children}
      {tip && (
        <div
          ref={box}
          role="tooltip"
          className={`pointer-events-none fixed z-(--z-toast) w-max max-w-72 rounded-lg border border-line bg-raised text-sm break-words text-primary shadow-lg [&_.note]:text-secondary ${card ? "" : "px-3 py-2.5 [&>strong]:mb-0.5 [&>strong]:block [&>strong]:font-semibold"}`}
          style={{ left: at?.left ?? tip.x + GAP, top: at?.top ?? tip.y + GAP, visibility: at ? "visible" : "hidden" }}
        >
          {tip.content}
        </div>
      )}
    </TipContext.Provider>
  );
}

export type TipRow = { label: ReactNode; value: ReactNode; swatch?: string };

/** What a tooltip says, laid out the same everywhere: what it is, its key number large, a line or a few rows of detail, the person most behind it, and what a click does. */
export function TipCard({
  icon,
  kicker,
  title,
  mono = false,
  swatch,
  value,
  unit,
  note,
  rows = [],
  body,
  person,
  hint,
}: {
  icon?: ReactNode;
  kicker?: ReactNode;
  title: ReactNode;
  mono?: boolean;
  swatch?: string;
  value?: ReactNode;
  unit?: ReactNode;
  note?: ReactNode;
  rows?: TipRow[];
  body?: ReactNode;
  person?: { login: string | null; name: string; note: ReactNode } | null;
  hint?: ReactNode;
}) {
  return (
    <div className="flex min-w-48 flex-col">
      <div className="flex flex-col gap-1 px-3 pt-2.5">
        {kicker && <span className="type-eyebrow">{kicker}</span>}
        <span className="flex min-w-0 items-center gap-2">
          {swatch && <span aria-hidden className="size-2.5 flex-none rounded-cell" style={{ background: swatch }} />}
          {icon && <span className="flex flex-none text-secondary">{icon}</span>}
          <span className={`min-w-0 text-sm font-semibold break-all ${mono ? "mono" : ""}`}>{title}</span>
        </span>
      </div>
      {value !== undefined && (
        <div className="flex flex-wrap items-baseline gap-x-1.5 px-3 pt-2">
          <span className="type-stat-sm">{value}</span>
          {unit && <span className="text-sm text-secondary">{unit}</span>}
          {note && <span className="ms-auto ps-3 text-sm font-medium whitespace-nowrap text-secondary tnum">{note}</span>}
        </div>
      )}
      {body && <p className="m-0 px-3 pt-1.5 type-caption text-pretty">{body}</p>}
      {rows.length > 0 && (
        <dl className="m-0 mt-2.5 flex flex-col gap-1 border-t border-line px-3 pt-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-4 text-sm">
              <dt className="flex min-w-0 items-center gap-1.5 text-secondary">
                {r.swatch && <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: r.swatch }} />}
                <span className="truncate">{r.label}</span>
              </dt>
              <dd className="m-0 font-medium whitespace-nowrap text-primary tnum">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {person && (
        <div className="mt-2.5 flex items-center gap-2 border-t border-line px-3 pt-2">
          <Face login={person.login} name={person.name} size={20} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{person.name}</span>
            <span className="truncate type-micro">{person.note}</span>
          </span>
        </div>
      )}
      {hint ? (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-b-lg border-t border-line bg-sunken px-3 py-1.5 type-micro">
          <MousePointerClick size={ICON.xs} aria-hidden />
          {hint}
        </div>
      ) : (
        <div className="h-2.5" />
      )}
    </div>
  );
}
