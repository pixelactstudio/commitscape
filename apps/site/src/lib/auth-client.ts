import { createAuthClient } from "better-auth/react";
import { returnTo, SIGN_IN } from "#/lib/access";
import { forgetViewer } from "#/lib/viewer";

export const authClient = createAuthClient();

/** Signs in with GitHub and comes back to `next` (a page of this Site, else the dashboard); a failed sign-in comes back to the sign-in page. The error's code when it could not start, else null. */
export async function signIn(next?: string): Promise<string | null> {
  const back = returnTo(next);
  const answer = await authClient.signIn.social({ provider: "github", callbackURL: back, errorCallbackURL: `${SIGN_IN}?${new URLSearchParams({ next: back })}` }).catch(() => null);
  return answer === null ? "unreachable" : answer.error ? (answer.error.code ?? "unknown") : null;
}

/** Signs out and forgets the cached viewer. */
export async function signOut() {
  await authClient.signOut();
  forgetViewer();
}
