/**
 * The Site's pages around their content: Astryx's shell with the product's
 * name, the Connect menu, and the theme, as the repository pages have.
 */
import type { ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Theme } from "@astryxdesign/core/theme";
import { ToastViewport } from "@astryxdesign/core/Toast";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { PRODUCT } from "@commitscape/data";
import { commitscapeTheme, Logo, MODES, useMode, type Mode } from "@commitscape/ui";
import { Connect } from "./Connect";

export function Frame({ children }: { children: ReactNode }) {
  const [mode, setMode] = useMode();
  return (
    <Theme theme={commitscapeTheme} mode={mode}>
      <ToastViewport>
        <AppShell
          height="auto"
          variant="surface"
          topNav={
            <TopNav
              label={PRODUCT}
              heading={<TopNavHeading logo={<Logo />} logoLabel={PRODUCT} heading={PRODUCT} headingHref="/" />}
              endContent={
                <div className="tools">
                  <Button label="Leaderboards" variant="ghost" size="sm" href="/leaderboards" />
                  <Connect />
                  <Selector
                    label="Theme"
                    isLabelHidden
                    variant="ghost"
                    size="sm"
                    value={mode}
                    onChange={(v) => setMode(v as Mode)}
                    options={MODES.map(([value, label]) => ({ value, label }))}
                  />
                </div>
              }
            />
          }
        >
          <div className="site">{children}</div>
          <footer className="site-foot note small">
            <a href="/privacy">What we keep</a> · <a href="https://github.com/pixelactstudio/commitscape">Source</a> ·
            MIT or Apache-2.0
          </footer>
        </AppShell>
      </ToastViewport>
    </Theme>
  );
}
