import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import type { WindowState } from "./address";
import { clampBox, EDGES, GEOMETRY_KEY, moved, PLACE_SCRIPT, readBox, resized, type Box, type Edge, type Room } from "./geometry";

export const WINDOW_ID = "code-window";
const TITLE_ID = "code-window-title";

const EDGE_CLASS: Record<Edge, string> = {
  n: "inset-x-3 -top-1 h-2 cursor-ns-resize",
  s: "inset-x-3 -bottom-1 h-2 cursor-ns-resize",
  e: "inset-y-3 -right-1 w-2 cursor-ew-resize",
  w: "inset-y-3 -left-1 w-2 cursor-ew-resize",
  ne: "-top-1 -right-1 size-4 cursor-nesw-resize",
  sw: "-bottom-1 -left-1 size-4 cursor-nesw-resize",
  nw: "-top-1 -left-1 size-4 cursor-nwse-resize",
  se: "-bottom-1 -right-1 size-4 cursor-nwse-resize",
};

const FRAME = {
  normal:
    "md:inset-auto md:top-[calc(var(--chrome-top)+1.5rem)] md:bottom-6 md:left-8 md:right-8 md:max-h-[42rem] lg:left-[calc(var(--sidebar-width)+2rem)] lg:max-w-[62rem] md:rounded-xl md:shadow-lg md:data-placed:top-(--win-y) md:data-placed:left-(--win-x) md:data-placed:right-auto md:data-placed:bottom-auto md:data-placed:max-h-none md:data-placed:max-w-none md:data-placed:w-(--win-w) md:data-placed:h-(--win-h)",
  max: "md:inset-x-0 md:top-(--header-height) md:bottom-0 md:border-t md:border-line",
  min: "",
} as const;

const wide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;

function roomOf(el: HTMLElement | null): Room {
  const top = el ? Number.parseFloat(getComputedStyle(el).getPropertyValue("--header-height")) * Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 56 : 56;
  return { width: window.innerWidth, height: window.innerHeight, top };
}

function place(el: HTMLElement, box: Box) {
  el.style.setProperty("--win-x", `${box.x}px`);
  el.style.setProperty("--win-y", `${box.y}px`);
  el.style.setProperty("--win-w", `${box.w}px`);
  el.style.setProperty("--win-h", `${box.h}px`);
  el.setAttribute("data-placed", "");
}

function save(box: Box) {
  try {
    window.localStorage.setItem(GEOMETRY_KEY, JSON.stringify(box));
  } catch {
    return;
  }
}

type Dots = { onClose: () => void; onMinimise: () => void; onToggleMax: () => void; state: WindowState; name: string };

function Dot({ label, tone, onClick, children }: { label: string; tone: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="plain-button hit grid size-3.5 place-items-center rounded-full text-transparent transition-colors duration-(--duration-instant) group-hover/dots:text-(--on-medal) group-focus-within/dots:text-(--on-medal) md:size-3"
      style={{ background: tone }}
    >
      {children}
    </button>
  );
}

function TrafficLights({ onClose, onMinimise, onToggleMax, state, name }: Dots) {
  return (
    <div className="group/dots flex flex-none items-center gap-2.5 ps-1 md:gap-3">
      <Dot label={`Close ${name}`} tone="var(--removed-solid)" onClick={onClose}>
        <X size={9} strokeWidth={3} aria-hidden />
      </Dot>
      <Dot label="Minimise to the corner" tone="var(--medal-1)" onClick={onMinimise}>
        <Minus size={9} strokeWidth={3} aria-hidden />
      </Dot>
      <span className="hidden md:contents">
        <Dot label={state === "max" ? "Restore the window's size" : "Maximise"} tone="var(--added-solid)" onClick={onToggleMax}>
          {state === "max" ? <Minimize2 size={8} strokeWidth={3} aria-hidden /> : <Maximize2 size={8} strokeWidth={3} aria-hidden />}
        </Dot>
      </span>
    </div>
  );
}

/** A floating application window over the workspace: dragged by its title bar, resized from any edge or corner, maximised, minimised to a chip or closed; a full-screen sheet on phones. A non-modal dialog named by its title; its box is remembered by the browser. */
export function CodeWindow({
  state,
  title,
  name,
  actions,
  onClose,
  onMinimise,
  onToggleMax,
  onKey,
  focusKey,
  drawn = false,
  children,
}: {
  state: WindowState;
  title: ReactNode;
  name: string;
  actions?: ReactNode;
  onClose: () => void;
  onMinimise: () => void;
  onToggleMax: () => void;
  onKey?: (e: KeyboardEvent<HTMLElement>) => void;
  focusKey: number;
  drawn?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    const saved = readBox(window.localStorage.getItem(GEOMETRY_KEY));
    if (saved && ref.current) setBox(clampBox(saved, roomOf(ref.current)));
  }, []);

  useEffect(() => {
    if (focusKey === 0) return;
    const el = ref.current;
    if (!el || el.hidden) return;
    heading.current?.focus({ preventScroll: true });
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.animate(still ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "translateY(10px) scale(0.985)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }, [focusKey]);

  useEffect(() => {
    if (!box) return;
    const fit = () => {
      const next = clampBox(box, roomOf(ref.current));
      if (next.x !== box.x || next.y !== box.y || next.w !== box.w || next.h !== box.h) setBox(next);
    };
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [box]);

  const drag = useCallback(
    (e: PointerEvent<HTMLElement>, how: (start: Box, dx: number, dy: number, room: Room) => Box) => {
      const el = ref.current;
      if (!el || e.button !== 0 || state !== "normal" || !wide()) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const start: Box = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      const room = roomOf(el);
      const x0 = e.clientX;
      const y0 = e.clientY;
      let last = start;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      document.documentElement.style.userSelect = "none";
      const move = (m: globalThis.PointerEvent) => {
        last = how(start, m.clientX - x0, m.clientY - y0, room);
        place(el, last);
      };
      const end = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", end);
        target.removeEventListener("pointercancel", end);
        document.documentElement.style.userSelect = "";
        if (last !== start) {
          setBox(last);
          save(last);
        }
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", end);
      target.addEventListener("pointercancel", end);
    },
    [state],
  );

  const onTitleDown = (e: PointerEvent<HTMLElement>) => {
    if (e.target instanceof Element && e.target.closest("button, a, input, [role=button]")) return;
    drag(e, (start, dx, dy, room) => moved(start, dx, dy, room));
  };

  const placed = state === "normal" && box !== null;
  const style = placed ? ({ "--win-x": `${box.x}px`, "--win-y": `${box.y}px`, "--win-w": `${box.w}px`, "--win-h": `${box.h}px` } as CSSProperties) : undefined;

  return (
    <>
      <section
        ref={ref}
        id={WINDOW_ID}
        role="dialog"
        aria-labelledby={TITLE_ID}
        data-state={state}
        data-placed={placed ? "" : undefined}
        hidden={state === "min"}
        suppressHydrationWarning
        style={style}
        onKeyDown={onKey}
        className={`fixed inset-0 z-(--z-overlay) flex-col bg-surface text-primary md:ring-1 md:ring-line ${state === "min" ? "hidden" : "flex"} ${FRAME[state]}`}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
        <header
          onPointerDown={onTitleDown}
          onDoubleClick={(e) => {
            if (!(e.target instanceof Element && e.target.closest("button, a, input"))) onToggleMax();
          }}
          className={`flex h-11 flex-none items-center gap-3 border-b border-line bg-sunken ps-3 pe-1.5 select-none md:h-10 ${state === "normal" ? "md:cursor-grab md:active:cursor-grabbing" : ""}`}
        >
          <TrafficLights onClose={onClose} onMinimise={onMinimise} onToggleMax={onToggleMax} state={state} name={name} />
          <h2 ref={heading} id={TITLE_ID} tabIndex={-1} className="m-0 flex min-w-0 flex-1 items-baseline justify-center gap-1.5 truncate text-sm font-medium outline-offset-2 md:px-2">
            {title}
          </h2>
          <div className="flex flex-none items-center gap-0.5">{actions}</div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
        {state === "normal" &&
          EDGES.map((edge) => <div key={edge} aria-hidden onPointerDown={(e) => drag(e, (start, dx, dy, room) => resized(start, edge, dx, dy, room))} className={`absolute z-(--z-raised) hidden touch-none md:block ${EDGE_CLASS[edge]}`} />)}
      </section>
      {drawn && <script dangerouslySetInnerHTML={{ __html: PLACE_SCRIPT(WINDOW_ID) }} />}
    </>
  );
}
