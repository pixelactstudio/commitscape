import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
  tint?: string;
  decorative?: boolean;
  className?: string;
};

function initials(name: string): string {
  const words = name.replace(/^@/, "").split(/[\s._-]+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

const AVATAR = [16, 20, 24, 32, 36, 40, 48, 60, 64, 72, 96, 128, 144] as const;

const EDGES = { surface: "var(--color-background-surface)", body: "var(--color-background-body)", stage: "var(--stage-cell-1)" } as const;

function Picture({ login, name, size, bucket, tint, decorative }: { login: string | null | undefined; name: string; size: number; bucket: number; tint?: string | undefined; decorative: boolean }) {
  const [broken, setBroken] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const img = image.current;
    if (img && img.complete && img.naturalWidth === 0) setBroken(true);
  }, []);
  const letters = size < 24 ? initials(name).slice(0, 1) : initials(name);
  const initialsFor = (
    <span aria-label={decorative ? undefined : name} role={decorative ? undefined : "img"} className="grid size-full place-items-center font-semibold select-none" style={{ background: tint ? `color-mix(in srgb, ${tint} 26%, var(--color-background-surface))` : "var(--color-bg-active)", color: "var(--color-text-primary)", fontSize: Math.max(12, Math.round(size * 0.38)) }}>
      {letters}
    </span>
  );
  if (!login || broken) return initialsFor;
  return <img ref={image} src={avatarUrl(login, bucket)} alt={decorative ? "" : name} width={bucket} height={bucket} loading="lazy" decoding="async" onError={() => setBroken(true)} className="size-full bg-track object-cover" />;
}

/** A person's GitHub avatar, or their initials when no GitHub account is known: always a square box the image is bound to, with an optional coloured ring and glow, a cut-out edge against what is behind it, and a lift. */
export function Face({ login, name, size = 24, wide, shape = "circle", ring, glow = false, edge, lift, tint, decorative = false, className = "" }: FaceProps) {
  const big = AVATAR.find((n) => n >= Math.max(size, wide ?? 0)) ?? 144;
  const round = shape === "circle" ? "rounded-full after:rounded-full" : size >= 64 ? "rounded-2xl after:rounded-2xl" : "rounded-md after:rounded-md";
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
    <span aria-hidden={decorative || undefined} className={`relative inline-grid aspect-square size-(--face) min-w-(--face) flex-none shrink-0 place-items-center overflow-hidden ${align} align-middle leading-none after:pointer-events-none after:absolute after:inset-0 after:shadow-[inset_0_0_0_1px_var(--image-outline)] after:content-[''] sm:size-(--face-wide) sm:min-w-(--face-wide) ${round} ${className}`} style={box}>
      <Picture key={login ?? ""} login={login} name={name} size={size} bucket={big} tint={tint} decorative={decorative} />
    </span>
  );
}
