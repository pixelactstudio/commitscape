import { useEffect, useLayoutEffect, useRef } from "react";
import { cellKey, COLOUR, hexAt, WEEK_SECONDS } from "@commitscape/data/universe";
import type { Feed } from "./feed";
import type { Look, Rgb } from "./look";
import type { FrameAnswer, Summary } from "./protocol";

export type FlatProps = {
  summary: Summary;
  feed: Feed<FrameAnswer | null>;
  look: Look;
  lens: number;
  focus: [number, number] | null;
  roleMask: number;
  selected: number | null;
  at: number;
  insets: { top: number; right: number; bottom: number; left: number };
  onHover: (rank: number | null, x: number, y: number) => void;
  onPick: (rank: number | null, double: boolean) => void;
};

const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const css = (c: Rgb) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;
const bucket = (age: number) => (age < 13 ? 0 : age < 52 ? 1 : age < 104 ? 2 : 3);

/** The Atlas drawn flat on a 2D canvas, for browsers without WebGL: the same hexes, colours and lenses seen from above; drag to move, wheel to zoom. */
export function Flat(p: FlatProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ x: 0, z: 0, scale: 1, ready: false });
  const latest = useRef(p);
  const index = useRef<Map<number, number> | null>(null);
  const drawRef = useRef<() => void>(() => undefined);

  function draw() {
    const c = canvas.current;
    const q = latest.current;
    if (!c) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    const b = q.summary.bounds;
    const v = view.current;
    if (!v.ready) {
      const i = q.insets;
      const sw = Math.max(80, w - i.left - i.right);
      const sh = Math.max(80, h - i.top - i.bottom);
      v.scale = Math.min(sw / (b.maxX - b.minX + 6), sh / (b.maxZ - b.minZ + 6));
      v.x = (b.minX + b.maxX) / 2 - (i.left - i.right) / 2 / v.scale;
      v.z = (b.minZ + b.maxZ) / 2 - (i.top - i.bottom) / 2 / v.scale;
      v.ready = true;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = css(q.look.deep);
    g.fillRect(0, 0, w, h);
    const now = (q.at - q.summary.origin) / WEEK_SECONDS;
    const f = q.feed.value;
    const slots = [...q.look.slots, q.look.other, q.look.sand, q.look.slots[0] ?? q.look.other];
    const batches = new Map<string, number[]>();
    const r = Math.max(0.6, v.scale * 0.96);
    for (let i = 0; i < q.summary.count; i++) {
      const born = q.summary.born[i] as number;
      if (born > now) continue;
      const sx = ((q.summary.x[i] as number) - v.x) * v.scale + w / 2;
      const sy = ((q.summary.z[i] as number) - v.z) * v.scale + h / 2;
      if (sx < -r || sy < -r || sx > w + r || sy > h + r) continue;
      let colour: Rgb;
      if ((q.summary.died[i] as number) <= now) colour = q.look.seabed;
      else {
        const age = now - (f ? (f.touched[i] as number) : -1e6);
        if (q.lens === 1) colour = q.look.roles[q.summary.role[i] as number] ?? q.look.other;
        else if (q.lens === 2) colour = q.look.stale[bucket(age)] ?? q.look.snow;
        else if (q.lens === 3) colour = q.look.languages[q.summary.language[i] as number] ?? q.look.other;
        else {
          colour = slots[f ? (f.colour[i] as number) : COLOUR.nobody] ?? q.look.sand;
          colour = mix(colour, q.look.snow, [0, 0.25, 0.55, 0.9][bucket(age)] ?? 0);
        }
        const shown = (!q.focus || (i >= q.focus[0] && i < q.focus[1])) && (q.roleMask >> (q.summary.role[i] as number)) & 1;
        if (!shown) colour = mix(q.look.dim, colour, 0.18);
      }
      const key = css(colour);
      let list = batches.get(key);
      if (!list) batches.set(key, (list = []));
      list.push(sx, sy);
    }
    for (const [colour, list] of batches) {
      g.fillStyle = colour;
      g.beginPath();
      for (let k = 0; k < list.length; k += 2) {
        const cx = list[k] as number;
        const cy = list[k + 1] as number;
        if (r < 2) {
          g.rect(cx - r, cy - r, r * 2, r * 2);
          continue;
        }
        for (let s = 0; s < 6; s++) {
          const a = Math.PI / 6 + (s * Math.PI) / 3;
          const px = cx + Math.cos(a) * r;
          const py = cy + Math.sin(a) * r;
          if (s === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
      }
      g.fill();
    }
    const font = getComputedStyle(c).fontFamily;
    g.font = `500 13px ${font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const taken: [number, number, number, number][] = [];
    for (const region of q.summary.regions) {
      if (!region.island || region.radius * v.scale < 22) continue;
      const lx = (region.x - v.x) * v.scale + w / 2;
      const ly = (region.z - v.z) * v.scale + h / 2;
      const tw = g.measureText(region.name).width + 16;
      const box: [number, number, number, number] = [lx - tw / 2, ly - 11, lx + tw / 2, ly + 11];
      if (box[0] < 0 || box[2] > w || box[1] < 0 || box[3] > h || taken.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
      taken.push(box);
      g.fillStyle = q.look.night ? "rgb(20 22 28 / 0.8)" : "rgb(255 255 255 / 0.85)";
      g.beginPath();
      g.roundRect(box[0], box[1], tw, 22, 11);
      g.fill();
      g.fillStyle = q.look.night ? "white" : "rgb(30 32 40)";
      g.fillText(region.name, lx, ly + 0.5);
    }
    if (q.selected !== null) {
      const sx = ((q.summary.x[q.selected] as number) - v.x) * v.scale + w / 2;
      const sy = ((q.summary.z[q.selected] as number) - v.z) * v.scale + h / 2;
      g.strokeStyle = q.look.night ? "white" : "black";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx, sy, Math.max(4, r * 1.4), 0, Math.PI * 2);
      g.stroke();
    }
  }

  useLayoutEffect(() => {
    latest.current = p;
    drawRef.current = draw;
    draw();
  });

  useEffect(() => p.feed.listen(() => drawRef.current()), [p.feed]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(c);
    let drag: { x: number; y: number; moved: number } | null = null;
    let last = 0;
    const rankAt = (x: number, y: number): number | null => {
      const q = latest.current;
      const v = view.current;
      if (!index.current) {
        index.current = new Map();
        for (let i = 0; i < q.summary.count; i++) {
          const [hq, hr] = hexAt(q.summary.x[i] as number, q.summary.z[i] as number);
          index.current.set(cellKey(hq, hr), i);
        }
      }
      const [hq, hr] = hexAt((x - c.clientWidth / 2) / v.scale + v.x, (y - c.clientHeight / 2) / v.scale + v.z);
      const i = index.current.get(cellKey(hq, hr));
      if (i === undefined) return null;
      return (q.summary.born[i] as number) <= (q.at - q.summary.origin) / WEEK_SECONDS ? i : null;
    };
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
    };
    const move = (e: PointerEvent) => {
      const rect = c.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag = { x: e.clientX, y: e.clientY, moved: drag.moved + Math.abs(dx) + Math.abs(dy) };
        view.current.x -= dx / view.current.scale;
        view.current.z -= dy / view.current.scale;
        drawRef.current();
      }
      latest.current.onHover(rankAt(e.clientX - rect.left, e.clientY - rect.top), e.clientX - rect.left, e.clientY - rect.top);
    };
    const up = (e: PointerEvent) => {
      const rect = c.getBoundingClientRect();
      if (drag && drag.moved < 5) {
        const now = performance.now();
        latest.current.onPick(rankAt(e.clientX - rect.left, e.clientY - rect.top), now - last < 320);
        last = now;
      }
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      view.current.scale = Math.max(0.2, Math.min(60, view.current.scale * Math.exp(-e.deltaY * 0.0015)));
      drawRef.current();
    };
    const leave = () => latest.current.onHover(null, 0, 0);
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointerleave", leave);
    c.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointerleave", leave);
      c.removeEventListener("wheel", wheel);
    };
  }, []);

  return <canvas ref={canvas} className="absolute inset-0 size-full touch-none" aria-hidden />;
}
