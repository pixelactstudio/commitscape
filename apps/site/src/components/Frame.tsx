import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Kbd } from "@astryxdesign/core/Kbd";
import { TopNav, TopNavItem } from "@astryxdesign/core/TopNav";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useMatches, useRouteContext, useRouter, useRouterState } from "@tanstack/react-router";
import { Briefcase, Image as ImageIcon, LayoutDashboard, LogOut, Menu, Monitor, Moon, Search, Settings, Sparkles, Sun, Swords, User } from "lucide-react";
import { PRODUCT } from "@commitscape/data";
import { Face, Logo, useMode, type Mode } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { SIGN_IN } from "#/lib/access";
import { signIn, signOut } from "#/lib/auth-client";
import { Footer } from "#/components/Footer";
import { SearchPalette } from "#/components/SearchPalette";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/vs", label: "Versus", icon: Swords },
] as const;

const YEAR = new Date().getUTCFullYear();

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    frame?: FrameKind;
  }
}

export type FrameKind = "page" | "workspace";

function useFrameKind(): FrameKind {
  return useMatches({ select: (matches) => (matches.some((m) => m.staticData?.frame === "workspace") ? "workspace" : "page") });
}

/** Every page's frame: the bar with search and the account, the page in its frame, and the footer; every bar shares the frame's edges. */
export function Frame({ children }: { children: ReactNode }) {
  const [searching, setSearching] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const open = useCallback((o: boolean) => setSearching(o), []);
  const kind = useFrameKind();
  const { user } = useRouteContext({ from: "__root__" });
  const signedIn = !!user;
  return (
    <div data-frame={kind} className="contents">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="sticky top-0 z-(--z-header) border-b border-line bg-surface">
        <TopNav
          label={PRODUCT}
          heading={
            <Link to={signedIn ? "/dashboard" : "/"} className="flex items-center gap-2 rounded-lg pe-2 text-lg font-semibold tracking-tight text-primary no-underline" aria-label={`${PRODUCT}, home`}>
              <Logo size={26} />
              <span className="hidden sm:inline">{PRODUCT}</span>
            </Link>
          }
          startContent={
            signedIn ? (
              <span className="hidden items-center gap-0.5 lg:flex">
                {NAV.map((n) => (
                  <TopNavItem key={n.to} label={n.label} href={n.to} isSelected={path === n.to || path.startsWith(`${n.to}/`)} />
                ))}
              </span>
            ) : undefined
          }
          endContent={
            <div className="flex items-center gap-1.5">
              {signedIn && <SearchButton onOpen={() => setSearching(true)} />}
              <ThemeMenu />
              <Account />
              {signedIn && (
                <span className="lg:hidden">
                  <MobileMenu />
                </span>
              )}
            </div>
          }
        />
      </header>
      <Progress />
      <main id="main" tabIndex={-1} className="min-h-(--main-height) outline-none">
        {children}
      </main>
      <Footer compact={kind === "workspace"} />
      {signedIn && <SearchPalette isOpen={searching} onOpenChange={open} />}
    </div>
  );
}

function Progress() {
  const loading = useRouterState({ select: (s) => s.isLoading || s.status === "pending" });
  return <div aria-hidden className={`nav-progress ${loading ? "nav-progress-on" : ""}`} />;
}

function SearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="hidden h-8 w-72 cursor-pointer items-center gap-2 rounded-md border border-line bg-sunken px-2.5 text-sm text-secondary transition-colors duration-(--duration-instant) hover:border-line-strong hover:text-primary md:flex"
      >
        <Search size={ICON.sm} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-start">Search people or repos</span>
        <Kbd keys="mod+k" />
      </button>
      <span className="md:hidden">
        <Button label="Search" isIconOnly icon={<Search size={ICON.md} />} variant="ghost" size="md" onClick={onOpen} tooltip="Search (⌘K)" />
      </span>
    </>
  );
}

const MODE_ICON: Record<Mode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

function ThemeMenu() {
  const [mode, setMode] = useMode();
  const Icon = MODE_ICON[mode];
  return (
    <DropdownMenu
      button={{ label: "Theme", isIconOnly: true, icon: <Icon size={ICON.md} />, variant: "ghost", size: "md", tooltip: "Theme" }}
      hasChevron={false}
      alignment="end"
      menuWidth={180}
      items={[
        { label: "Light", icon: Sun, onClick: () => setMode("light"), endContent: mode === "light" ? "✓" : undefined },
        { label: "Dark", icon: Moon, onClick: () => setMode("dark"), endContent: mode === "dark" ? "✓" : undefined },
        { label: "Follow the system", icon: Monitor, onClick: () => setMode("system"), endContent: mode === "system" ? "✓" : undefined },
      ]}
    />
  );
}

function Account() {
  const { user } = useRouteContext({ from: "__root__" });
  const path = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const queryClient = useQueryClient();
  if (!user) return path === SIGN_IN ? null : <Button label="Sign in" variant="secondary" size="sm" onClick={() => void signIn(path)} />;
  const go = (to: string) => void router.navigate({ to: to as "/" });
  const shown = user.login ?? user.name;
  return (
    <DropdownMenu
      button={{ label: `Signed in as ${shown}`, isIconOnly: true, icon: <Face login={user.login} name={shown} size={24} decorative />, variant: "ghost", size: "md" }}
      hasChevron={false}
      alignment="end"
      menuWidth={240}
      items={[
        ...(user.login
          ? [
              {
                type: "section" as const,
                title: `@${user.login}`,
                items: [
                  { label: "Dashboard", icon: LayoutDashboard, onClick: () => go("/dashboard") },
                  { label: "Your Profile", icon: User, onClick: () => go(`/u/${user.login}`) },
                  { label: "Your Cards", icon: ImageIcon, onClick: () => go(`/u/${user.login}/cards`) },
                  { label: "Proof of Work", icon: Briefcase, onClick: () => go(`/u/${user.login}/work`) },
                  { label: `Wrapped ${YEAR}`, icon: Sparkles, onClick: () => go(`/u/${user.login}/wrapped/${YEAR}`) },
                ],
              },
              { type: "divider" as const },
            ]
          : []),
        { label: "Settings", icon: Settings, onClick: () => go("/me") },
        {
          label: "Sign out",
          icon: LogOut,
          onClick: async () => {
            await signOut();
            queryClient.removeQueries();
            await router.invalidate();
          },
        },
      ]}
    />
  );
}

function MobileMenu() {
  const router = useRouter();
  return (
    <DropdownMenu
      button={{ label: "Menu", isIconOnly: true, icon: <Menu size={ICON.md} />, variant: "ghost", size: "md" }}
      hasChevron={false}
      alignment="end"
      presentation="adaptive"
      items={NAV.map((n) => ({ label: n.label, icon: n.icon, onClick: () => void router.navigate({ to: n.to as "/" }) }))}
    />
  );
}
