import type { UseNavigateResult } from "@tanstack/react-router";
import { parseTarget } from "@commitscape/data";

/** Goes to the Profile or repository page someone typed; false when it is neither. */
export function goTo(text: string, navigate: UseNavigateResult<string>): boolean {
  const target = parseTarget(text);
  if (!target) return false;
  if (target.kind === "person") void navigate({ to: "/u/$login", params: { login: target.login } });
  else void navigate({ to: "/gh/$owner/$repo", params: { owner: target.owner, repo: target.name } });
  return true;
}
