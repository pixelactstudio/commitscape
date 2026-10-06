import { useCallback, useState, type ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Kbd } from "@astryxdesign/core/Kbd";
import { TopNav, TopNavItem } from "@astryxdesign/core/TopNav";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouteContext, useRouter, useRouterState } from "@tanstack/react-router";
import { Briefcase, Flag, Image as ImageIcon, LogOut, Menu, Monitor, Moon, Search, Settings, Sparkles, Sun, Swords, Trophy, User, Users } from "lucide-react";
import { PRODUCT } from "@commitscape/data";
import { Logo, useMode, type Mode } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { signIn, signOut } from "#/lib/auth-client";
import { Footer } from "#/components/Footer";
import { SearchPalette } from "#/components/SearchPalette";

const NAV = [
  { to: "/leaderboards", label: "Leaderboards", icon: Trophy },
  { to: "/vs", label: "Versus", icon: Swords },
  { to: "/races", label: "Races", icon: Flag },
  { to: "/crews", label: "Crews", icon: Users },
] as const;

const YEAR = new Date().getUTCFullYear();

/** Every page's frame: the bar with search and the account, and the footer. */
export function Frame({ children }: { children: ReactNode }) {
  const [searching, setSearching] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const open = useCallback((o: boolean) => setSearching(o), []);
  return (
    <AppShell
      height="auto"
      variant="section"
      mobileNav={false}
      topNav={
        <TopNav
          label={PRODUCT}
          heading={
            <Link to="/" className="flex items-center gap-2 rounded-lg pe-2 text-lg font-semibold tracking-tight text-primary no-underline" aria-label={`${PRODUCT}, home`}>
              <Logo size={26} />
              <span className="hidden sm:inline">{PRODUCT}</span>
            </Link>
          }
          startContent={
            <span className="hidden items-center gap-0.5 lg:flex">
              {NAV.map((n) => (
                <TopNavItem key={n.to} label={n.label} href={n.to} isSelected={path === n.to || path.startsWith(`${n.to}/`)} />
              ))}
            </span>
          }
          endContent={
            <div className="flex items-center gap-1.5">
              <SearchButton onOpen={() => setSearching(true)} />
              <ThemeMenu />
              <Account />
              <span className="lg:hidden">
                <MobileMenu />
              </span>
            </div>
          }
        />
      }
    >
      <Progress />
      <div className="min-h-[calc(100dvh-var(--header-height))]">{children}</div>
      <Footer />
      <SearchPalette isOpen={searching} onOpenChange={open} />
    </AppShell>
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
        className="hidden h-8 w-64 cursor-pointer items-center gap-2 rounded-md border border-line bg-muted px-2.5 text-sm text-secondary transition-colors hover:border-line-strong hover:text-primary md:flex"
      >
        <Search size={ICON.sm} aria-hidden />
        <span className="flex-1 text-start">Search people or repos</span>
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
  if (!user) return <Button label="Sign in" variant="primary" size="sm" onClick={() => signIn(path === "/" ? "/you" : path)} />;
  const go = (to: string) => void router.navigate({ to: to as "/" });
  return (
    <DropdownMenu
      button={{ label: `Signed in as ${user.login}`, isIconOnly: true, icon: <Avatar src={user.image ?? undefined} name={user.login} size="sm" tooltip={false} />, variant: "ghost", size: "md" }}
      hasChevron={false}
      alignment="end"
      menuWidth={240}
      items={[
        {
          type: "section",
          title: `@${user.login}`,
          items: [
            { label: "Your Profile", icon: User, onClick: () => go(`/u/${user.login}`) },
            { label: "Your Cards", icon: ImageIcon, onClick: () => go(`/u/${user.login}/cards`) },
            { label: "Proof of Work", icon: Briefcase, onClick: () => go(`/u/${user.login}/work`) },
            { label: `Wrapped ${YEAR}`, icon: Sparkles, onClick: () => go(`/u/${user.login}/wrapped/${YEAR}`) },
          ],
        },
        { type: "divider" },
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
