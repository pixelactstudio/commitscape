import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export function signIn(callbackURL = "/me") {
  void authClient.signIn.social({ provider: "github", callbackURL });
}
