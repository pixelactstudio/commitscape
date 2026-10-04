import { createAuthClient } from "better-auth/react";
import { forgetViewer } from "#/lib/viewer";

export const authClient = createAuthClient();

export function signIn(callbackURL = "/me") {
  void authClient.signIn.social({ provider: "github", callbackURL });
}

/** Signs out and forgets the cached viewer. */
export async function signOut() {
  await authClient.signOut();
  forgetViewer();
}
