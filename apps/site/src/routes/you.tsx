import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/you")({
  beforeLoad: ({ context }) => {
    throw redirect(context.user ? { to: "/u/$login", params: { login: context.user.login } } : { to: "/me" });
  },
});
