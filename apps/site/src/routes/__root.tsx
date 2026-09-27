/// <reference types="vite/client" />
import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { PRODUCT } from "@commitscape/data";
import styles from "@commitscape/ui/styles.css?url";
import { getViewer } from "#/functions/account";
import { Analytics } from "#/integrations/posthog";
import "#/share-key";
import app from "#/styles/app.css?url";
import site from "#/site.css?url";

type Viewer = Awaited<ReturnType<typeof getViewer>>;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient } & Partial<Viewer>>()({
  beforeLoad: () => getViewer(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: PRODUCT },
      { name: "description", content: "See any git repository's story: who knows which part, what is fragile, what changes together." },
    ],
    links: [
      { rel: "stylesheet", href: styles },
      { rel: "stylesheet", href: app },
      { rel: "stylesheet", href: site },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  shellComponent: Document,
  component: () => (
    <Analytics>
      <Outlet />
    </Analytics>
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
        <Devtools />
        <Scripts />
      </body>
    </html>
  );
}

function Devtools() {
  if (!import.meta.env.DEV) return null;
  return <DevtoolsPanel />;
}

function DevtoolsPanel() {
  return (
    <TanStackDevtools
      config={{ position: "bottom-right" }}
      plugins={[
        { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
        { name: "TanStack Query", render: <ReactQueryDevtoolsPanel /> },
      ]}
    />
  );
}
