import { Avatar } from "@astryxdesign/core/Avatar";
import { avatarUrl } from "./avatar";

export type FaceSize = 16 | 20 | 24 | 32 | 36 | 40 | 48 | 60 | 64 | 72 | 96 | 128 | 144;

/** A person's GitHub avatar, or their initials when no GitHub account is known; always square, never squeezed by its row, with an optional coloured ring. */
export function Face({ login, name, size = 24, shape = "circle", ring }: { login: string | null | undefined; name: string; size?: FaceSize; shape?: "circle" | "rounded"; ring?: string }) {
  const round = shape === "circle" ? "rounded-full" : "rounded-md";
  return (
    <span
      className={`relative inline-grid aspect-square flex-none shrink-0 place-items-center self-center align-middle leading-none ${round}`}
      style={{ width: size, height: size, minWidth: size, margin: ring ? 4 : undefined, boxShadow: ring ? `0 0 0 2px var(--surface), 0 0 0 4px ${ring}` : undefined }}
    >
      <Avatar src={login ? avatarUrl(login, size) : undefined} name={name} size={size} shape={shape} tooltip={false} />
    </span>
  );
}
