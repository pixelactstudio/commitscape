/// <reference types="vite/client" />
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { createRootRouteWithContext, HeadContent, Outlet, redirect, Scripts, useRouteContext } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { Theme } from "@astryxdesign/core/theme";
import { LinkProvider } from "@astryxdesign/core/Link";
import { ToastViewport } from "@astryxdesign/core/Toast";
import { PRODUCT } from "@commitscape/data";
import { commitscapeTheme, MODE_COOKIE, ModeContext, themeCss, type Mode } from "@commitscape/ui";
import { MotionProvider } from "@commitscape/ui/motion";
import styles from "@commitscape/ui/styles.css?url";
import type { getViewer } from "#/functions/account";
import { isOpenPage, returnTo } from "#/lib/access";
import { rememberViewer, viewer } from "#/lib/viewer";
import { Analytics } from "#/integrations/posthog";
import type { Person } from "#/lib/analytics";
import { ConsentBanner } from "#/components/Consent";
import { PUBLIC_GLOBAL } from "#/lib/env";
import { Frame } from "#/components/Frame";
import { RouterLink } from "#/components/RouterLink";
import "#/share-key";
import app from "#/styles/app.css?url";
import look from "#/styles/look.css?url";

type Viewer = Awaited<ReturnType<typeof getViewer>>;

const THEME_CSS = themeCss();

export const Route = createRootRouteWithContext<{ queryClient: QueryClient } & Partial<Viewer>>()({
  beforeLoad: async ({ location }) => {
    const v = await viewer();
    if (!v.user && location.pathname !== "/" && !isOpenPage(location.pathname)) throw redirect({ to: "/sign-in", search: { next: returnTo(location.href) } });
    return v;
  },
  loader: ({ context }) => ({ public: context.public ?? {}, origin: context.origin ?? "" }),
  head: ({ loaderData }) => ({
    scripts: [{ children: `window.${PUBLIC_GLOBAL}=${JSON.stringify(loaderData?.public ?? {}).replaceAll("<", "\\u003c")}` }],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: PRODUCT },
      { name: "description", content: "What a developer has built, how they stand next to the people they work with, and cards to share it." },
      { name: "theme-color", content: "#f6f7f9", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#090a0d", media: "(prefers-color-scheme: dark)" },
      { property: "og:site_name", content: PRODUCT },
      { property: "og:image", content: `${loaderData?.origin ?? ""}/api/cards/site/preview.png` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: styles },
      { rel: "stylesheet", href: app },
      { rel: "stylesheet", href: look },
      { rel: "preload", as: "font", type: "font/woff2", href: "/fonts/InterVariable.woff2", crossOrigin: "anonymous" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
    styles: [{ children: THEME_CSS }],
  }),
  shellComponent: Document,
  component: Root,
});

function Document({ children }: { children: ReactNode }) {
  const { mode } = useRouteContext({ from: "__root__" });
  return (
    <html lang="en" data-theme={mode && mode !== "system" ? mode : undefined} data-astryx-theme={commitscapeTheme.name} suppressHydrationWarning>
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

function Root() {
  const context = useRouteContext({ from: "__root__" });
  const first = context.mode;
  useState(() => {
    if (context.origin !== undefined && context.public && context.user !== undefined && context.mode && context.analytics) rememberViewer({ origin: context.origin, public: context.public, user: context.user, mode: context.mode, analytics: context.analytics } as Viewer);
    return null;
  });
  const [mode, setMode] = useState<Mode>(first ?? "system");
  const choose = useCallback((m: Mode) => {
    quiet();
    setMode(m);
    document.cookie = `${MODE_COOKIE}=${m}; path=/; max-age=31536000; samesite=lax`;
  }, []);
  useEffect(() => {
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", quiet);
    return () => scheme.removeEventListener("change", quiet);
  }, []);
  const value = useMemo(() => [mode, choose] as [Mode, (m: Mode) => void], [mode, choose]);
  const id = context.analytics?.id ?? null;
  const { login = null, name = null, image = null } = context.user ?? {};
  const person = useMemo<Person | null>(() => (id ? { id, login, name, image } : null), [id, login, name, image]);
  return (
    <ModeContext value={value}>
      <Theme theme={commitscapeTheme} mode={mode}>
        <LinkProvider component={RouterLink}>
          <ToastViewport>
            <Analytics on={!!context.public?.PUBLIC_POSTHOG_KEY} region={context.analytics?.region} choice={context.analytics?.choice} level={context.analytics?.level} person={person}>
              <MotionProvider>
                <Frame>
                  <Outlet />
                </Frame>
                <ConsentBanner />
              </MotionProvider>
            </Analytics>
          </ToastViewport>
        </LinkProvider>
      </Theme>
    </ModeContext>
  );
}

function quiet() {
  const root = document.documentElement;
  root.classList.add("no-transitions");
  void root.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("no-transitions")));
}

function Devtools() {
  if (!import.meta.env.DEV || import.meta.env.VITE_NO_DEVTOOLS) return null;
  return <DevtoolsPanel />;
}

function DevtoolsPanel() {
  return (
    <TanStackDevtools
      config={{ position: "bottom-left", hideUntilHover: true }}
      plugins={[
        { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
        { name: "TanStack Query", render: <ReactQueryDevtoolsPanel /> },
      ]}
    />
  );
}
