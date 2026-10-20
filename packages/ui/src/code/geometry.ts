export type Box = { x: number; y: number; w: number; h: number };

export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type Room = { width: number; height: number; top: number };

export const EDGES: readonly Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export const MIN_W = 520;
export const MIN_H = 340;
const GRIP = 160;
const TITLE = 44;

export const GEOMETRY_KEY = "commitscape.code.window";

/** A window's box kept inside the room: no smaller than the minimum, no larger than the room, and its title bar always reachable. */
export function clampBox(box: Box, room: Room): Box {
  const w = Math.round(Math.min(Math.max(box.w, MIN_W), room.width));
  const h = Math.round(Math.min(Math.max(box.h, MIN_H), room.height - room.top));
  const x = Math.round(Math.min(Math.max(box.x, GRIP - w), room.width - GRIP));
  const y = Math.round(Math.min(Math.max(box.y, room.top), room.height - TITLE));
  return { x, y, w, h };
}

/** A window's box after one of its edges or corners was dragged by dx, dy: the opposite edge stays put, and the minimum size holds. */
export function resized(box: Box, edge: Edge, dx: number, dy: number, room: Room): Box {
  let { x, y, w, h } = box;
  if (edge.includes("e")) w = Math.max(MIN_W, Math.min(box.w + dx, room.width - box.x));
  if (edge.includes("s")) h = Math.max(MIN_H, Math.min(box.h + dy, room.height - box.y));
  if (edge.includes("w")) {
    const right = box.x + box.w;
    x = Math.min(Math.max(box.x + dx, 0), right - MIN_W);
    w = right - x;
  }
  if (edge.includes("n")) {
    const bottom = box.y + box.h;
    y = Math.min(Math.max(box.y + dy, room.top), bottom - MIN_H);
    h = bottom - y;
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** A window's box after its title bar was dragged by dx, dy, kept inside the room. */
export const moved = (box: Box, dx: number, dy: number, room: Room): Box => clampBox({ ...box, x: box.x + dx, y: box.y + dy }, room);

/** The box remembered in this browser, or null when there is none or it is not one. */
export function readBox(text: string | null): Box | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<Box>;
    return [v.x, v.y, v.w, v.h].every((n) => typeof n === "number" && Number.isFinite(n)) ? (v as Box) : null;
  } catch {
    return null;
  }
}

/** The script that puts a remembered box on the server-drawn window before the browser first paints it, so it does not jump on hydration. */
export const PLACE_SCRIPT = (id: string) =>
  `(function(){try{var b=JSON.parse(localStorage.getItem(${JSON.stringify(GEOMETRY_KEY)})||"null"),e=document.getElementById(${JSON.stringify(id)});if(!b||!e||e.getAttribute("data-state")!=="normal")return;var W=innerWidth,H=innerHeight,t=parseFloat(getComputedStyle(e).getPropertyValue("--header-height"))*parseFloat(getComputedStyle(document.documentElement).fontSize)||56,w=Math.min(Math.max(b.w,${MIN_W}),W),h=Math.min(Math.max(b.h,${MIN_H}),H-t);e.style.setProperty("--win-x",Math.min(Math.max(b.x,${GRIP}-w),W-${GRIP})+"px");e.style.setProperty("--win-y",Math.min(Math.max(b.y,t),H-${TITLE})+"px");e.style.setProperty("--win-w",w+"px");e.style.setProperty("--win-h",h+"px");e.setAttribute("data-placed","")}catch(_){}})()`;
