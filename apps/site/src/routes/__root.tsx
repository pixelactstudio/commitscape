/// <reference types="vite/client" />
import type { ReactNode } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import styles from "@commitscape/ui/styles.css?url";
import { Client } from "../components/Client";
// First: a Shared Report's key leaves the address bar before anything renders.
import "../share-key";
import site from "../site.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: PRODUCT },
      { name: "description", content: "See any git repository's story: who knows which part, what is fragile, what changes together." },
    ],
    links: [
      { rel: "stylesheet", href: styles },
      { rel: "stylesheet", href: site },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  shellComponent: Document,
  component: () => (
    <Client>
      <Outlet />
    </Client>
  ),
});

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
