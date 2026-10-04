import { Suspense, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import type { Meta } from "@commitscape/data";
import { TipLayer } from "./charts/Tip";
import { Key } from "./components/Key";
import { SCREEN_SKELETONS } from "./components/skeletons";
import { StaleContext, useSource } from "./data";
import { WINDOW_WORDS } from "./format";
import { HelpContext, LoginsContext } from "./help";
import { SHORTCUT_WORDS, useShortcuts } from "./keys";
import { Palette } from "./Palette";
import { paramsOf, SCREENS, TITLES, type Go, type Route, type Screen } from "./route";
import { Activity } from "./screens/Activity";
import { Commits } from "./screens/Commits";
import { MapScreen } from "./screens/Map";
import { Overview } from "./screens/Overview";
import { People } from "./screens/People";

const WINDOW_BUTTONS: Record<string, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
  all: "All time",
};

const NO_LOGINS: ReadonlyMap<number, string> = new Map();

/** Every screen of a Report under the page's own header; the page owns the route. */
export default function App({
  route,
  go,
  logins = NO_LOGINS,
  nav,
}: {
  route: Route;
  go: Go;
  logins?: ReadonlyMap<number, string>;
  nav?: ReactNode;
}) {
  const source = useSource();
  const meta = source.meta;
  return (
    <LoginsContext value={logins}>
      <TipLayer>
        <Shell meta={meta} route={route} go={go} nav={nav} />
      </TipLayer>
    </LoginsContext>
  );
}

function Shell({ meta, route, go, nav }: { meta: Meta; route: Route; go: Go; nav?: ReactNode }) {
  const [help, setHelp] = useState(false);
  const [palette, setPalette] = useState(false);
  const { from, to, person, folder, window } = route;
  const params = useMemo(() => paramsOf({ screen: "overview", from, to, person, folder, window }, meta), [from, to, person, folder, window, meta]);
  const deferredParams = useDeferredValue(params);
  const span = route.window ?? meta.window;
  const ranged = route.from !== undefined || route.to !== undefined;
  const props = { meta, route, go, params: deferredParams };
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
  const Skeleton = SCREEN_SKELETONS[route.screen];

  return (
    <HelpContext value={help}>
      <div className={`app${help ? " keys-on" : ""}`}>
        <div className="screen-bar">
          <TabList value={route.screen} onChange={(s) => go({ screen: s as Screen, id: undefined, file: undefined })} hasDivider>
            {SCREENS.map((s, i) => (
              <Tab key={s} value={s} label={TITLES[s]} endContent={<Key keys={String(i + 1)} />} />
            ))}
          </TabList>
          <div className="windows">
            <SegmentedControl label="Window" size="sm" value={ranged ? "" : span} onChange={(w) => go({ window: w, from: undefined, to: undefined })}>
              {meta.windows.map((w) => (
                <SegmentedControlItem key={w} value={w} label={WINDOW_BUTTONS[w] ?? w} />
              ))}
            </SegmentedControl>
            <Button label="Search" variant="secondary" size="sm" onClick={() => setPalette(true)} endContent={<Key keys="mod+k" />} />
            <Button
              label="Help"
              variant={help ? "primary" : "ghost"}
              size="sm"
              aria-pressed={help}
              onClick={() => setHelp(!help)}
              tooltip="What the numbers mean, and every key (?)"
              endContent={<Key keys="?" />}
            />
            {nav}
          </div>
        </div>
        {help && <Help ranged={ranged} span={span} filtered={route.person !== undefined || !!route.folder} />}
        <StaleContext value={deferredParams !== params}>
          <Suspense fallback={<Skeleton />}>
            {route.screen === "overview" && <Overview {...props} />}
            {route.screen === "activity" && <Activity {...props} />}
            {route.screen === "people" && <People {...props} />}
            {route.screen === "map" && <MapScreen {...props} />}
            {route.screen === "commits" && <Commits {...props} />}
          </Suspense>
        </StaleContext>
      </div>
      <Palette isOpen={palette} onOpenChange={setPalette} window={span} go={go} />
    </HelpContext>
  );
}

function Help({ ranged, span, filtered }: { ranged: boolean; span: string; filtered: boolean }) {
  return (
    <section className="help" aria-label="Help">
      <p>
        Explanations are shown under every number, and each key is marked on screen. Each number is over{" "}
        {ranged ? "the dates chosen" : (WINDOW_WORDS[span] ?? span)}
        {filtered ? ", and the filters above" : ""}.
      </p>
      <dl className="shortcuts">
        {SHORTCUT_WORDS.map(([keys, words]) => (
          <div key={keys}>
            <dt>
              {keys === "1–5" ? (
                <>
                  <Key keys="1" /> to <Key keys="5" />
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
