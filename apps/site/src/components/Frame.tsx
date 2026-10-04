import { useState, type ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { TopNav } from "@astryxdesign/core/TopNav";
import { useNavigate, useRouteContext, useRouterState } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { Logo, MODES, useMode, type Mode } from "@commitscape/ui";
import { signIn } from "#/lib/auth-client";
import { goTo } from "#/lib/target";

export function Frame({ children }: { children: ReactNode }) {
  const [mode, setMode] = useMode();
  const { user } = useRouteContext({ from: "__root__" });
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <AppShell
      height="auto"
      variant="surface"
      topNav={
        <TopNav
          label={PRODUCT}
          heading={
            <a href="/" className="flex items-center gap-2 font-semibold tracking-tight text-[1.05rem] no-underline" style={{ color: "var(--text)" }}>
              <Logo size={28} />
              <span>{PRODUCT}</span>
            </a>
          }
          endContent={
            <div className="tools">
              {path !== "/" && <Search />}
              <span className="hide-small">
                <Button label="Leaderboards" variant="ghost" size="sm" href="/leaderboards" />
              </span>
              {user ? (
                <a href={`/u/${user.login}`} className="flex items-center gap-2 rounded-full px-1 py-0.5 no-underline" style={{ color: "var(--text)" }} aria-label="Your profile">
                  <Avatar src={user.image ?? undefined} name={user.login} size="sm" tooltip={false} />
                </a>
              ) : (
                <Button label="Sign in" variant="secondary" size="sm" onClick={() => signIn(path === "/" ? "/me" : path)} />
              )}
              <span className="hide-small">
              <Selector
                label="Theme"
                isLabelHidden
                variant="ghost"
                size="sm"
                value={mode}
                onChange={(v) => setMode(v as Mode)}
                options={MODES.map(([value, label]) => ({ value, label }))}
              />
              </span>
            </div>
          }
        />
      }
    >
      <div className="site">{children}</div>
      <footer className="site-foot note small">
        <a href="/races">Races</a> · <a href="/crews">Crews</a> · <a href="/privacy">What we keep</a> · <a href="/me">Settings</a> · <a href="https://github.com/pixelactstudio/commitscape">Source</a> · MIT or
        Apache-2.0
      </footer>
    </AppShell>
  );
}

function Search() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [wrong, setWrong] = useState(false);
  return (
    <form
      role="search"
      className="hidden md:block"
      onSubmit={(e) => {
        e.preventDefault();
        if (goTo(text, navigate)) setText("");
        else setWrong(true);
      }}
    >
      <input
        aria-label="A GitHub username or repository"
        placeholder="Username or owner/repo"
        value={text}
        aria-invalid={wrong || undefined}
        onChange={(e) => {
          setText(e.target.value);
          setWrong(false);
        }}
        className="header-search"
      />
    </form>
  );
}
