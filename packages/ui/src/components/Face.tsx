import type { CSSProperties } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { avatarUrl } from "./avatar";

export type FaceSize = 16 | 20 | 24 | 32 | 36 | 40 | 48 | 56 | 60 | 64 | 72 | 80 | 96 | 112 | 128 | 144;

export type FaceProps = {
  login: string | null | undefined;
  name: string;
  size?: FaceSize;
  wide?: FaceSize;
  shape?: "circle" | "rounded";
  ring?: string;
  glow?: boolean;
  edge?: "surface" | "body" | "stage";
  lift?: "md" | "float";
  className?: string;
};

const AVATAR = [16, 20, 24, 32, 36, 40, 48, 60, 64, 72, 96, 128, 144] as const;
const FILL = { width: "100%", height: "100%" };

const EDGES = { surface: "var(--color-background-surface)", body: "var(--color-background-body)", stage: "var(--stage-cell-1)" } as const;

/** A person's GitHub avatar, or their initials when no GitHub account is known: always a square box the image is bound to, with an optional coloured ring and glow, a cut-out edge against what is behind it, and a lift. */
export function Face({ login, name, size = 24, wide, shape = "circle", ring, glow = false, edge, lift, className = "" }: FaceProps) {
  const big = AVATAR.find((n) => n >= Math.max(size, wide ?? 0)) ?? 144;
  const round = shape === "circle" ? "rounded-full" : size >= 64 ? "rounded-2xl" : "rounded-md";
  const align = /(^|\s)self-/.test(className) ? "" : "self-center";
  const gap = size >= 64 ? 3 : 2;
  const line = size >= 96 ? 3 : 2;
  const cut = size >= 64 ? 4 : 2;
  const shadows = [
    edge && !ring ? `0 0 0 ${cut}px ${EDGES[edge]}` : null,
    ring && glow ? `0 14px 36px -12px color-mix(in oklab, ${ring} 70%, transparent)` : null,
    lift ? `var(--shadow-${lift})` : null,
  ].filter(Boolean);
  const box = {
    "--face": `${size}px`,
    "--face-wide": `${wide ?? size}px`,
    margin: ring ? gap + line : undefined,
    outline: ring ? `${line}px solid ${ring}` : undefined,
    outlineOffset: ring ? gap : undefined,
    boxShadow: shadows.length > 0 ? shadows.join(", ") : undefined,
  } as CSSProperties;
  return (
    <span className={`relative inline-grid aspect-square size-(--face) min-w-(--face) flex-none shrink-0 place-items-center overflow-hidden ${align} align-middle leading-none sm:size-(--face-wide) sm:min-w-(--face-wide) ${round} ${className}`} style={box}>
      <Avatar src={login ? avatarUrl(login, big) : undefined} name={name} size={big} shape={shape} tooltip={false} style={FILL} />
    </span>
  );
}
