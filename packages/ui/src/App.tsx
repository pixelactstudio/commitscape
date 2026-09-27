import { useState, type ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Theme } from "@astryxdesign/core/theme";
import { ToastViewport } from "@astryxdesign/core/Toast";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { PRODUCT, type Meta } from "@commitscape/data";
import { TipLayer } from "./charts/Tip";
import { Key } from "./components/Key";
import { Logo } from "./components/Logo";
import { SaveCard } from "./components/SaveCard";
import { useSource } from "./data";
import { WINDOW_WORDS } from "./format";
import { AvatarsContext, HelpContext } from "./help";
import { SHORTCUT_WORDS, useShortcuts } from "./keys";
import { Palette } from "./Palette";
import { paramsOf, SCREENS, TITLES, type Go, type Route, type Screen } from "./route";
import { Activity } from "./screens/Activity";
import { MapScreen } from "./screens/Map";
import { Overview } from "./screens/Overview";
import { People } from "./screens/People";
import { Commits } from "./screens/Commits";
import { Risk } from "./screens/Risk";
import { commitscapeTheme, MODES, useMode, type Mode } from "./theme";

const WINDOW_BUTTONS: Record<string, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
  all: "All time",
};

/** Every screen of a Report in its shell; the page owns the route. */
export default function App({ route, go, home, nav }: { route: Route; go: Go; home?: string; nav?: ReactNode }) {
  const source = useSource();
  const [mode, setMode] = useMode();
  return (
    <Theme theme={commitscapeTheme} mode={mode}>
      <ToastViewport>
        <Shell meta={source.meta} route={route} go={go} mode={mode} setMode={setMode} home={home} nav={nav} />
      </ToastViewport>
    </Theme>
  );
}

function Shell({
  meta,
  route,
  go,
  mode,
  setMode,
  home,
  nav,
}: {
  meta: Meta;
  route: Route;
  go: Go;
  mode: Mode;
  setMode: (m: Mode) => void;
  home?: string;
  nav?: ReactNode;
}) {
  const source = useSource();
  const [help, setHelp] = useState(false);
  const [palette, setPalette] = useState(false);
  const params = paramsOf(route, meta);
  const span = route.window ?? meta.window;
  const ranged = route.from !== undefined || route.to !== undefined;
  const props = { meta, route, go, params };
  const step = (by: number) => {
    const i = meta.windows.indexOf(span);
    const next = meta.windows[(i + by + meta.windows.length) % meta.windows.length];
    if (next) go({ window: next, from: undefined, to: undefined });
  };
  const shortcuts: Record<string, () => void> = {
    "?": () => setHelp((h) => !h),
    "/": () => {
      const box = document.querySelector<HTMLInputElement>(".commit-search input");
      if (route.screen === "commits" && box) box.focus();
      else setPalette(true);
    },
    "mod+k": () => setPalette((p) => !p),
    w: () => step(1),
    W: () => step(-1),
    Escape: () => {
      if (help) setHelp(false);
      else if (route.file) go({ file: undefined }, true);
    },
  };
  SCREENS.forEach((s, i) => {
    shortcuts[String(i + 1)] = () => go({ screen: s, id: undefined, file: undefined });
  });
  useShortcuts(shortcuts);

  const topNav = (
    <TopNav
      label={PRODUCT}
      heading={
        <TopNavHeading
          logo={<Logo />}
          logoLabel={PRODUCT}
          heading={meta.name}
          superheading={PRODUCT}
          superheadingHref={home}
        />
      }
      endContent={
        <div className="tools">
          {nav}
          <Button
            label="Jump to…"
            variant="secondary"
            size="sm"
            onClick={() => setPalette(true)}
            endContent={<Key keys="mod+k" />}
          />
          <Button
            label="Help"
            variant={help ? "primary" : "ghost"}
            size="sm"
            aria-pressed={help}
            onClick={() => setHelp(!help)}
            tooltip="What the numbers mean, and every key (?)"
            endContent={<Key keys="?" />}
          />
          <Selector
            label="Theme"
            isLabelHidden
            variant="ghost"
            size="sm"
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={MODES.map(([value, label]) => ({ value, label }))}
          />
          <SaveCard load={() => source.card(span)} file={`${meta.name}-card-${span}.png`} />
        </div>
      }
    />
  );
  return (
    <HelpContext value={help}>
      <AvatarsContext value={meta.avatars}>
        <TipLayer>
          <AppShell height="auto" variant="surface" topNav={topNav}>
            <div className={`app${help ? " keys-on" : ""}`}>
              <div className="screen-bar">
                <TabList value={route.screen} onChange={(s) => go({ screen: s as Screen, id: undefined, file: undefined })} hasDivider>
                  {SCREENS.map((s, i) => (
                    <Tab key={s} value={s} label={TITLES[s]} endContent={<Key keys={String(i + 1)} />} />
                  ))}
                </TabList>
                <div className="windows">
                  <SegmentedControl
                    label="Window"
                    size="sm"
                    value={ranged ? "" : span}
                    onChange={(w) => go({ window: w, from: undefined, to: undefined })}
                  >
                    {meta.windows.map((w) => (
                      <SegmentedControlItem key={w} value={w} label={WINDOW_BUTTONS[w] ?? w} />
                    ))}
                  </SegmentedControl>
                  <Key keys="w" />
                </div>
              </div>
              {help && <Help ranged={ranged} span={span} filtered={route.person !== undefined || !!route.folder} />}
              {route.screen === "overview" && <Overview {...props} />}
              {route.screen === "activity" && <Activity {...props} />}
              {route.screen === "people" && <People {...props} />}
              {route.screen === "map" && <MapScreen {...props} />}
              {route.screen === "risk" && <Risk {...props} />}
              {route.screen === "commits" && <Commits {...props} />}
            </div>
          </AppShell>
          <Palette isOpen={palette} onOpenChange={setPalette} window={span} go={go} />
        </TipLayer>
      </AvatarsContext>
    </HelpContext>
  );
}

function Help({ ranged, span, filtered }: { ranged: boolean; span: string; filtered: boolean }) {
  return (
    <section className="help" aria-label="Help">
      <p>
        Explanations are shown under every number, and each key is marked on screen. Each number is over{" "}
        {ranged ? "the dates chosen" : WINDOW_WORDS[span] ?? span}
        {filtered ? ", and the filters above" : ""}.
      </p>
      <dl className="shortcuts">
        {SHORTCUT_WORDS.map(([keys, words]) => (
          <div key={keys}>
            <dt>
              {keys === "1–6" ? (
                <>
                  <Key keys="1" /> to <Key keys="6" />
                </>
              ) : (
                <Key keys={keys} />
              )}
            </dt>
            <dd>{words}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
