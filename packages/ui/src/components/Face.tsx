import { Avatar } from "@astryxdesign/core/Avatar";
import { avatarUrl } from "./avatar";

export type FaceSize = 20 | 24 | 32 | 40 | 48 | 64 | 96 | 128;

/** A person's GitHub avatar, or their initials when no GitHub account is known. */
export function Face({ login, name, size = 24 }: { login: string | null | undefined; name: string; size?: FaceSize }) {
  return <Avatar src={login ? avatarUrl(login, size) : undefined} name={name} size={size} tooltip={false} />;
}
