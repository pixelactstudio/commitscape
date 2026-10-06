import { Suspense, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { CircleHelp, FolderTree, GitCommitHorizontal, LayoutGrid, Search, Users, Activity as Pulse, type LucideIcon } from "lucide-react";
import type { Meta } from "@commitscape/data";
import { TipLayer } from "./charts/Tip";
import { Key } from "./components/Key";
import { Page } from "./kit/layout";
import { ICON } from "./design/tokens";
import { AnimatePresence, DISTANCE, DURATION, EASE, motion } from "./motion";
import { StandingContext } from "./components/Name";
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

const ICONS: Record<Screen, LucideIcon> = {
  overview: LayoutGrid,
  people: Users,
  activity: Pulse,
  map: FolderTree,
  commits: GitCommitHorizontal,
};

const NO_LOGINS: ReadonlyMap<number, string> = new Map();

export type Extras = Partial<Record<Screen, ReactNode>>;

/** Every screen of a Report under the page's own header: a full-width bar of screens and Windows docked on the header's bottom edge, sticky under the top bar, then the screen; the page owns the route. */
export default function App({
  route,
  go,
  logins = NO_LOGINS,
  nav,
  standing,
  extras,
  notice,
}: {
  route: Route;
  go: Go;
  logins?: ReadonlyMap<number, string>;
  nav?: ReactNode;
  standing?: (login: string) => string;
  extras?: Extras;
  notice?: ReactNode;
}) {
  const source = useSource();
  return (
    <LoginsContext value={logins}>
      <StandingContext value={standing ?? null}>
        <TipLayer>
          <Shell meta={source.meta} route={route} go={go} nav={nav} extras={extras} notice={notice} />
        </TipLayer>
      </StandingContext>
    </LoginsContext>
  );
}

function Shell({ meta, route, go, nav, extras, notice }: { meta: Meta; route: Route; go: Go; nav?: ReactNode; extras?: Extras; notice?: ReactNode }) {
  const [help, setHelp] = useState(false);
  const [palette, setPalette] = useState(false);
  const { from, to, person, folder, window } = route;
  const params = useMemo(() => paramsOf({ screen: "overview", from, to, person, folder, window }, meta), [from, to, person, folder, window, meta]);
  const deferredParams = useDeferredValue(params);
  const span = route.window ?? meta.window;
  const ranged = route.from !== undefined || route.to !== undefined;
  const props = { meta, route, go, params: deferredParams };
  const setWindow = (w: string) => go({ window: w, from: undefined, to: undefined });
  const step = (by: number) => {
    const i = meta.windows.indexOf(span);
    const next = meta.windows[(i + by + meta.windows.length) % meta.windows.length];
    if (next) setWindow(next);
  };
  const choose = (s: Screen) => go({ screen: s, id: undefined, file: undefined });
  const shortcuts: Record<string, () => void> = {
    "?": () => setHelp((h) => !h),
    "/": () => {
      const box = document.querySelector<HTMLInputElement>("[data-commit-search] input");
      if (route.screen === "commits" && box) box.focus();
      else setPalette(true);
    },
    "mod+k": () => setPalette((p) => !p),
    w: () => step(1),
    W: () => step(-1),
  };
  if (help) shortcuts.Escape = () => setHelp(false);
  else if (route.file) shortcuts.Escape = () => go({ file: undefined }, true);
  SCREENS.forEach((s, i) => {
    shortcuts[String(i + 1)] = () => choose(s);
  });
  useShortcuts(shortcuts);
  const Skeleton = SCREEN_SKELETONS[route.screen];
  const windows = meta.windows.map((w) => ({ value: w, label: WINDOW_BUTTONS[w] ?? w }));

  return (
    <HelpContext value={help}>
      <div className="min-w-0 pb-16">
        <ScreenBar
          route={route}
          help={help}
          choose={choose}
          end={
            <div className="flex flex-none items-center gap-1.5">
            <SegmentedControl label="Window" size="sm" value={ranged ? "" : span} onChange={setWindow}>
              {windows.map((w) => (
                <SegmentedControlItem key={w.value} value={w.value} label={w.label} />
              ))}
            </SegmentedControl>
            {help && <Key keys="w" />}
            <Tools help={help} setHelp={setHelp} openPalette={() => setPalette(true)} nav={nav} />
            </div>
          }
          below={
            <div className="flex items-center gap-2 pb-2.5">
              <div className="min-w-0 flex-1">
                <Selector label="Window" isLabelHidden size="sm" value={ranged ? undefined : span} placeholder="The dates chosen" onChange={setWindow} options={windows} width="100%" />
              </div>
              <Tools help={help} setHelp={setHelp} openPalette={() => setPalette(true)} nav={nav} />
            </div>
          }
        />
        <Page>
          {notice}
          {help && <Help ranged={ranged} span={span} filtered={route.person !== undefined || !!route.folder} />}
          <StaleContext value={deferredParams !== params}>
            <ScreenMotion screen={route.screen}>
              <Suspense fallback={<Skeleton />}>
                {route.screen === "overview" && <Overview {...props} />}
                {route.screen === "activity" && <Activity {...props} />}
                {route.screen === "people" && <People {...props} extra={extras?.people} />}
                {route.screen === "map" && <MapScreen {...props} />}
                {route.screen === "commits" && <Commits {...props} />}
              </Suspense>
              {route.screen !== "people" && extras?.[route.screen] && <div className="pt-gutter">{extras[route.screen]}</div>}
            </ScreenMotion>
          </StaleContext>
        </Page>
      </div>
      <Palette isOpen={palette} onOpenChange={setPalette} window={span} go={go} />
    </HelpContext>
  );
}

/** The bar of screens, full width under the page's header and sticky under the top bar once the header scrolls away. */
export function ScreenBar({ route, help = false, choose, end, below }: { route: Pick<Route, "screen">; help?: boolean; choose?: (s: Screen) => void; end?: ReactNode; below?: ReactNode }) {
  const isWide = useWide();
  const mark = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = mark.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const seen = new IntersectionObserver(([e]) => setStuck(!!e && !e.isIntersecting), { rootMargin: "-54px 0px 0px 0px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  return (
    <>
      <div ref={mark} aria-hidden className="h-0" />
      <div data-stuck={stuck || undefined} className="screen-bar sticky top-header z-(--z-sticky) border-b border-line bg-body/88 backdrop-blur-md backdrop-saturate-150 transition-shadow duration-(--duration-fast) data-[stuck]:shadow-md">
        <Page>
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <TabList value={route.screen} onChange={(s) => choose?.(s as Screen)} size="md">
                {SCREENS.map((s, i) => {
                  const Glyph = ICONS[s];
                  return <Tab key={s} value={s} label={TITLES[s]} icon={<Glyph size={ICON.sm} strokeWidth={2} aria-hidden />} endContent={help ? <Key keys={String(i + 1)} /> : undefined} />;
                })}
              </TabList>
            </div>
            {end && isWide !== false && <div className="hidden md:block">{end}</div>}
          </div>
          {below && isWide !== true && <div className="md:hidden">{below}</div>}
        </Page>
      </div>
    </>
  );
}

function useWide(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const q = window.matchMedia("(min-width: 48rem)");
    const set = () => setWide(q.matches);
    set();
    q.addEventListener("change", set);
    return () => q.removeEventListener("change", set);
  }, []);
  return wide;
}

function ScreenMotion({ screen, children }: { screen: Screen; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      <motion.div key={screen} initial={{ opacity: 0, y: DISTANCE.nudge }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DURATION.base, ease: EASE.out }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function Tools({ help, setHelp, openPalette, nav }: { help: boolean; setHelp: (h: boolean) => void; openPalette: () => void; nav?: ReactNode }) {
  return (
    <>
      <IconButton label="Search people, folders, files and commits" tooltip="Search (Ctrl K)" variant="secondary" size="sm" icon={<Icon icon={Search} size="sm" />} onClick={openPalette} />
      <IconButton label="Help" tooltip="What the numbers mean, and every key (?)" variant={help ? "primary" : "ghost"} size="sm" icon={<Icon icon={CircleHelp} size="sm" />} aria-pressed={help} onClick={() => setHelp(!help)} />
      {nav}
    </>
  );
}

function Help({ ranged, span, filtered }: { ranged: boolean; span: string; filtered: boolean }) {
  return (
    <section aria-label="Help" className="fade mt-5 flex flex-col gap-3 rounded-lg border border-accent-bg bg-surface p-panel text-sm">
      <p className="m-0 text-pretty">
        Every number is over <strong>{ranged ? "the dates chosen" : (WINDOW_WORDS[span] ?? span)}</strong>
        {filtered ? ", and the filters chosen" : ""}. What each one means is now shown beneath it, and every key is ringed on screen.
      </p>
      <dl className="m-0 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {SHORTCUT_WORDS.map(([keys, words]) => (
          <div key={keys} className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
            <dt className="flex items-center gap-1 text-secondary">
              {keys === "1–5" ? (
                <>
                  <Key keys="1" /> to <Key keys="5" />
                </>
              ) : (
                <Key keys={keys} />
              )}
            </dt>
            <dd className="m-0">{words}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
