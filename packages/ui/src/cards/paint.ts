export type Motion = "rise" | "grow" | "fill";

const KIND: Record<Motion, string> = { rise: "01", grow: "02", fill: "03" };
const CLASS: Record<Motion, string> = { rise: "r", grow: "g", fill: "c" };

/** How a Card colours its elements: plainly on the Site, or with a sentinel per animated element when it becomes an SVG. */
export type Paint = { readonly animated: boolean; mark(motion: Motion, colour: string, delay: number): string };

export const STILL: Paint = { animated: false, mark: (_motion, colour) => colour };

/** A Paint that remembers each animated element by a colour no Card uses, so the SVG can be given its animation afterwards. */
export function animatedPaint(): Paint & { marks: Map<string, { motion: Motion; colour: string; delay: number }> } {
  const marks = new Map<string, { motion: Motion; colour: string; delay: number }>();
  let next = 0;
  return {
    animated: true,
    marks,
    mark(motion, colour, delay) {
      const sentinel = `#${KIND[motion]}${(next++).toString(16).padStart(4, "0")}`;
      marks.set(sentinel, { motion, colour, delay });
      return sentinel;
    },
  };
}

const STYLE = [
  "@keyframes r{from{opacity:0;transform:translateY(8px)}}",
  ".r{animation:r .7s cubic-bezier(.2,.7,.2,1) backwards}",
  "@keyframes g{from{transform:scaleX(0)}}",
  ".g{transform-box:fill-box;transform-origin:left center;animation:g 1s cubic-bezier(.2,.7,.2,1) backwards}",
  "@keyframes c{from{opacity:0}}",
  ".c{animation:c .5s ease-out backwards}",
  "@media (prefers-reduced-motion:reduce){.r,.g,.c{animation:none}}",
].join("");

/** Gives each marked element of a Satori SVG its real colour and its animation, and adds the keyframes. */
export function animate(svg: string, marks: Map<string, { motion: Motion; colour: string; delay: number }>): string {
  const out = svg.replace(/fill="(#0[123][0-9a-f]{4})"/g, (all, sentinel: string) => {
    const m = marks.get(sentinel);
    if (!m) return all;
    return `fill="${m.colour}" class="${CLASS[m.motion]}" style="animation-delay:${Math.round(m.delay)}ms"`;
  });
  return out.replace(/^<svg([^>]*)>/, `<svg$1><style>${STYLE}</style>`);
}

/** The same SVG without its animation, in its final state, for a PNG. */
export function still(svg: string, marks: Map<string, { motion: Motion; colour: string; delay: number }>): string {
  return svg.replace(/fill="(#0[123][0-9a-f]{4})"/g, (all, sentinel: string) => {
    const m = marks.get(sentinel);
    return m ? `fill="${m.colour}"` : all;
  });
}
