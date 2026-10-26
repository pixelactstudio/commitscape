import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    if (context.user) throw redirect({ to: "/dashboard" });
    const landing = context.public?.PUBLIC_LANDING_URL;
    if (landing) throw redirect({ href: landing, reloadDocument: true });
    throw redirect({ to: "/sign-in" });
  },
});
