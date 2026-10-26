import type { CSSProperties, ReactNode } from "react";
import { DISTANCE } from "@commitscape/ui/motion/constants";

type Tag = "div" | "section" | "li" | "span" | "p" | "h2";

/** Fades, lifts and unblurs its children the first time they scroll into view, as the Site's Reveal does, drawn by CSS: the page's script only marks it seen, and without the script it is simply there. */
export function Reveal({ children, as = "div", y = DISTANCE.rise, blur = true, delay = 0, className = "" }: { children: ReactNode; as?: Tag; y?: number; blur?: boolean; delay?: number; className?: string }) {
  const Tag = as;
  const style = { "--reveal-y": `${y}px`, "--reveal-blur": blur ? "4px" : "0px", "--reveal-delay": `${delay}s` } as CSSProperties;
  return (
    <Tag data-reveal className={className} style={style}>
      {children}
    </Tag>
  );
}
