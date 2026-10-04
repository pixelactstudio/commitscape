import { Avatar } from "@astryxdesign/core/Avatar";
import { avatarUrl } from "./avatar";

export type FaceSize = 16 | 20 | 24 | 32 | 36 | 40 | 48 | 60 | 64 | 72 | 96 | 128 | 144;

/** A person's GitHub avatar, or their initials when no GitHub account is known. */
export function Face({ login, name, size = 24, shape = "circle" }: { login: string | null | undefined; name: string; size?: FaceSize; shape?: "circle" | "rounded" }) {
  return <Avatar src={login ? avatarUrl(login, size) : undefined} name={name} size={size} shape={shape} tooltip={false} />;
}
