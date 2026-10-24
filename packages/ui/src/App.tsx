import { Suspense, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { MobileNav } from "@astryxdesign/core/MobileNav";
import { Selector } from "@astryxdesign/core/Selector";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { SizeProvider } from "@astryxdesign/core/SizeContext";
import { CircleHelp, FileCode, GitBranch, GitPullRequest, Orbit, FolderTree, GitCommitHorizontal, LayoutGrid, PanelLeftOpen, Search, Users, Activity as Pulse, type LucideIcon } from "lucide-react";
import type { Meta } from "@commitscape/data";
import { TipLayer } from "./charts/Tip";
import { useFocusHeading } from "./components/focus";
import { Key } from "./components/Key";
import { ScreenHeader } from "./kit/primitives";
import { ICON } from "./design/tokens";
import { AnimatePresence, DURATION, EASE, motion } from "./motion";
import { StandingContext } from "./components/Name";
import { SCREEN_SKELETONS } from "./components/skeletons";
import { CountingContext, StaleContext, useSource } from "./data";
import { grouped, WINDOW_WORDS, within } from "./format";
import { HelpContext, LoginsContext } from "./help";
import { SHORTCUT_WORDS, useShortcuts } from "./keys";
import { Dates } from "./Dates";
import { Palette } from "./Palette";
import { GitContext, type GitSource } from "./git/source";
import { GROUPS, paramsOf, screenRoute, screensOf, TITLES, UNWINDOWED, type Go, type Route, type Screen } from "./route";
import { Activity } from "./screens/Activity";
import { BranchesScreen } from "./screens/Branches";
import { CodeLayer } from "./screens/Code";
import { PullsScreen } from "./screens/Pulls";
import { Commits } from "./screens/Commits";
import { MapScreen } from "./screens/Map";
import { UniverseScreen } from "./screens/Universe";
import { Overview } from "./screens/Overview";
import { People } from "./screens/People";

const WINDOW_BUTTONS: Record<string, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
  all: "All time",
};

const WINDOW_SHORT: Record<string, string> = { "30d": "30d", "90d": "90d", "1y": "1y", all: "All" };

const ICONS: Record<Screen, LucideIcon> = {
  overview: LayoutGrid,
  people: Users,
  activity: Pulse,
  map: FolderTree,
  universe: Orbit,
  commits: GitCommitHorizontal,
  code: FileCode,
  branches: GitBranch,
  pulls: GitPullRequest,
};

const NO_LOGINS: ReadonlyMap<number, string> = new Map();

export type Extras = Partial<Record<Screen, ReactNode>>;

export type WorkspaceSlots = {
  label: string;
  identity: ReactNode;
  bar: ReactNode;
  actions?: ReactNode;
  hero?: ReactNode;
  link: (route: Route) => string;
  counts?: Partial<Record<Screen, { n: number; noun: string }>>;
};

/** Every screen of a Report in its workspace: the sidebar with the repository, the Window and the screens, and the screen beside it; the page owns the route. */
export default function App({
  route,
  go,
  slots,
  logins = NO_LOGINS,
  standing,
  extras,
  notice,
  counting = false,
  git,
}: {
  route: Route;
  go: Go;
  slots: WorkspaceSlots;
  logins?: ReadonlyMap<number, string>;
  standing?: (login: string) => string;
  extras?: Extras;
  notice?: ReactNode;
  counting?: boolean;
  git?: GitSource;
}) {
  const source = useSource();
  return (
    <LoginsContext value={logins}>
      <StandingContext value={standing ?? null}>
        <CountingContext value={counting}>
          <TipLayer>
            <GitContext value={git ?? null}>
              <Shell meta={source.meta} route={route} go={go} slots={slots} extras={extras} notice={notice} git={git ?? null} />
            </GitContext>
          </TipLayer>
        </CountingContext>
      </StandingContext>
    </LoginsContext>
  );
}

function windowReason(screen: Screen): { short: string; long: string } {
  return screen === "universe"
    ? { short: "It has its own timeline", long: "Not used here: the Universe has its own timeline." }
    : { short: "Reads the whole history", long: "Not used here: this screen is read at the last Build, over the whole history." };
}

function countsOf(route: Route, span: string, git: GitSource | null): string {
  const over = route.from !== undefined || route.to !== undefined ? "over the dates chosen" : within(span);
  switch (route.screen) {
    case "people":
      return route.id === undefined ? `Everyone who made a commit ${over}` : `One person’s commits, days and files ${over}`;
    case "activity":
      return `When the commits were made ${over}`;
    case "map":
      return `Where the code is at HEAD, and where the commits went ${over}`;
    case "commits":
      return `Every commit ${over}, newest first`;
    case "universe":
      return "Every file the default branch ever had, as land, replayed commit by commit";
    case "code":
      return git ? `The ${grouped(git.status.files)} files at the last Build` : "The files at the last Build";
    case "branches":
      if (route.branch) return "";
      if (!git) return "Branches at the last Build";
      return `${grouped(git.status.openBranches)} open${git.status.branchesTotal > git.status.branches ? ` among the ${grouped(git.status.branches)} newest of ${grouped(git.status.branchesTotal)}` : ` of ${grouped(git.status.branches)}`} branches, and ${grouped(git.status.tagsTotal)} tags, at the last Build`;
    case "pulls":
      if (route.pr !== undefined) return "";
      return git ? `${grouped(git.status.openPulls)} open of ${grouped(git.status.pullsTotal)} pull requests read from GitHub` : "Pull requests read from GitHub";
    default:
      return "";
  }
}

function Shell({ meta, route, go, slots, extras, notice, git }: { meta: Meta; route: Route; go: Go; slots: WorkspaceSlots; extras?: Extras; notice?: ReactNode; git: GitSource | null }) {
  const ranges = useSource().ranges === true;
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
  const screens = screensOf(git !== null);
  const choose = (s: Screen) => go(screenRoute(route, s));
  const shortcuts: Record<string, () => void> = {
    "?": () => setHelp((h) => !h),
    "/": () => {
      const box = document.querySelector<HTMLInputElement>("[data-commit-search] input");
      if (route.screen === "commits" && box) box.focus();
      else setPalette(true);
    },
    "mod+k": () => setPalette((p) => !p),
    w: () => !UNWINDOWED.has(route.screen) && step(1),
    W: () => !UNWINDOWED.has(route.screen) && step(-1),
  };
  if (help) shortcuts.Escape = () => setHelp(false);
  else if (route.file) shortcuts.Escape = () => go({ file: undefined }, true);
  screens.forEach((s, i) => {
    shortcuts[String(i + 1)] = () => choose(s);
  });
  useShortcuts(shortcuts);
  useFocusHeading(route.screen);
  const Skeleton = SCREEN_SKELETONS[route.screen];
  const windowed = !UNWINDOWED.has(route.screen);
  const windows = meta.windows.map((w) => ({ value: w, label: WINDOW_BUTTONS[w] ?? w, short: WINDOW_SHORT[w] ?? w }));
  const reason = windowReason(route.screen);
  const wide = route.screen === "universe";

  return (
    <HelpContext value={help}>
      <Workspace
        slots={slots}
        route={route}
        screens={screens}
        help={help}
        tools={<ReportTools help={help} setHelp={setHelp} openPalette={() => setPalette(true)} />}
        picker={
          <WindowGroup help={help} disabled={!windowed} reason={reason} range={ranges ? <Dates route={route} go={go} /> : null}>
            <WindowChoice windows={windows} value={ranged ? null : span} onChange={setWindow} disabled={!windowed} />
          </WindowGroup>
        }
        select={<Selector label="Window" isLabelHidden size="sm" value={ranged ? undefined : span} placeholder="The dates chosen" onChange={setWindow} options={windows.map(({ value, label }) => ({ value, label }))} width={132} isDisabled={!windowed} disabledMessage={windowed ? undefined : reason.long} />}
      >
        {route.screen === "overview" && slots.hero}
        <ScreenColumn wide={wide}>
          {route.screen !== "overview" && !wide && <ScreenHeader title={TITLES[route.screen]} counts={countsOf(route, span, git)} />}
          <div className={wide ? "px-(--main-pad) pt-3 empty:hidden" : "contents"}>
            {notice}
            {help && <Help ranged={ranged} span={span} filtered={route.person !== undefined || !!route.folder} screens={screens.length} windowed={windowed} />}
          </div>
          <StaleContext value={deferredParams !== params}>
            <ScreenMotion screen={route.screen}>
              <Suspense fallback={<Skeleton />}>
                {route.screen === "overview" && <Overview {...props} />}
                {route.screen === "activity" && <Activity {...props} />}
                {route.screen === "people" && <People {...props} extra={extras?.people} />}
                {route.screen === "map" && <MapScreen {...props} />}
                {route.screen === "universe" && <UniverseScreen {...props} />}
                {route.screen === "commits" && <Commits {...props} />}
                {route.screen === "branches" && git && <BranchesScreen {...props} />}
                {route.screen === "pulls" && git && <PullsScreen {...props} />}
              </Suspense>
              {route.screen !== "people" && extras?.[route.screen] && <div className="pt-gutter">{extras[route.screen]}</div>}
            </ScreenMotion>
          </StaleContext>
        </ScreenColumn>
      </Workspace>
      <Palette isOpen={palette} onOpenChange={setPalette} window={span} go={go} route={route} screens={screens} />
      <CodeLayer route={route} go={go} link={slots.link} repo={slots.label} />
    </HelpContext>
  );
}

/** The column a workspace screen reads in: centred in the main area and capped, or the whole main area for the Universe. */
export function ScreenColumn({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return <div className={wide ? "w-full" : "mx-auto w-full max-w-(--content) px-(--main-pad) pb-section"}>{children}</div>;
}

/** The workspace frame around a Report: on wide screens a sidebar under the top bar that never moves, below 1024px a slim bar whose menu opens the same sidebar as a drawer. */
export function Workspace({
  slots,
  route,
  screens,
  tools,
  picker,
  select,
  help = false,
  children,
}: {
  slots: WorkspaceSlots;
  route: Pick<Route, "screen"> & Partial<Route>;
  screens: readonly Screen[];
  tools?: ReactNode;
  picker?: ReactNode | null;
  select?: ReactNode;
  help?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const nav = (inDrawer: boolean) => <ScreenNav route={route} screens={screens} link={slots.link} counts={slots.counts} help={help} onPick={inDrawer ? () => setOpen(false) : undefined} />;
  return (
    <div className="lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
      <aside aria-label={slots.label} className="sticky top-(--header-height) hidden h-(--main-height) overflow-y-auto overscroll-contain border-e border-line bg-body lg:block">
        <div className="flex min-h-full flex-col">
          <div className="flex flex-col gap-3 px-2 pt-2 pb-1">
            {slots.identity}
            {(tools || picker !== null) && (
              <div className="flex flex-col gap-3 pb-2">
                {tools}
                {picker === undefined ? <PickerSkeleton /> : picker}
              </div>
            )}
          </div>
          <SideNav aria-label="Screens of this Report" style={{ width: "100%", height: "auto" }}>
            {nav(false)}
          </SideNav>
          {slots.actions && (
            <SizeProvider value="sm">
              <div className="mt-auto flex flex-col gap-2 border-t border-separator px-2 pt-3 pb-3 [&>*]:w-full">{slots.actions}</div>
            </SizeProvider>
          )}
        </div>
      </aside>
      <div className="min-w-0">
        <div className="sticky top-(--header-height) z-(--z-sticky) flex h-(--repo-bar-height) items-center gap-2 border-b border-line bg-body ps-2 pe-(--gutter) lg:hidden">
          <IconButton label="Open the screens of this Report" variant="ghost" size="md" icon={<PanelLeftOpen size={ICON.md} aria-hidden />} onClick={() => setOpen(true)} aria-expanded={open} />
          <div className="min-w-0 flex-1">{slots.bar}</div>
          {select}
        </div>
        <MobileNav isOpen={open} onOpenChange={setOpen} side="start" width={300} label={slots.label} header={slots.label}>
          <div className="flex flex-col gap-4 pb-4">
            {tools}
            {nav(true)}
            {slots.actions && <div className="flex flex-col gap-2 border-t border-separator px-2 pt-4">{slots.actions}</div>}
          </div>
        </MobileNav>
        {children}
      </div>
    </div>
  );
}

function ScreenNav({ route, screens, link, counts, help, onPick }: { route: Pick<Route, "screen"> & Partial<Route>; screens: readonly Screen[]; link: (route: Route) => string; counts?: WorkspaceSlots["counts"]; help: boolean; onPick?: () => void }) {
  return (
    <>
      {GROUPS.map((group) => {
        const shown = group.screens.filter((s) => screens.includes(s));
        if (shown.length === 0) return null;
        return (
          <SideNavSection key={group.title} title={group.title}>
            {shown.map((s) => {
              const Glyph = ICONS[s];
              const count = counts?.[s];
              const key = screens.indexOf(s) + 1;
              return (
                <SideNavItem
                  key={s}
                  label={TITLES[s]}
                  icon={<Glyph size={ICON.md} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />}
                  href={link(screenRoute({ ...route, screen: route.screen } as Route, s))}
                  isSelected={route.screen === s}
                  onClick={onPick}
                  endContent={
                    count || help ? (
                      <span className="flex items-center gap-1.5">
                        {count && (
                          <span className="type-micro text-secondary tnum">
                            <span className="sr-only">, </span>
                            {grouped(count.n)}
                            <span className="sr-only"> {count.noun}</span>
                          </span>
                        )}
                        {help && <Key keys={String(key)} />}
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </SideNavSection>
        );
      })}
    </>
  );
}

function WindowChoice({ windows, value, onChange, disabled }: { windows: { value: string; label: string; short: string }[]; value: string | null; onChange: (w: string) => void; disabled: boolean }) {
  return (
    <div role="radiogroup" aria-labelledby="window-label" aria-describedby={disabled ? "window-reason" : undefined} aria-disabled={disabled || undefined} className="flex flex-wrap gap-0.5">
      {windows.map((w) => (
        <label
          key={w.value}
          title={w.label}
          className={`relative grid h-7 flex-auto place-items-center rounded-md px-2 text-sm whitespace-nowrap transition-colors duration-(--duration-instant) has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-focus has-checked:bg-active has-checked:font-medium has-checked:text-primary ${disabled ? "cursor-not-allowed text-disabled" : "cursor-pointer text-secondary hover:bg-hover hover:text-primary"}`}
        >
          <input type="radio" name="window" value={w.value} checked={value === w.value} disabled={disabled} onChange={() => onChange(w.value)} className="sr-only" />
          {w.short}
          <span className="sr-only"> ({w.label})</span>
        </label>
      ))}
    </div>
  );
}

function WindowGroup({ help, disabled, reason, range, children }: { help: boolean; disabled: boolean; reason: { short: string; long: string }; range: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 px-1">
      <div className="flex items-center justify-between gap-2">
        <span id="window-label" className="type-eyebrow">
          Window
        </span>
        {help && !disabled && <Key keys="w" />}
      </div>
      {children}
      <div className="flex h-7 items-center">
        {disabled ? (
          <p id="window-reason" title={reason.long} className="m-0 type-caption">
            {reason.short}
            <span className="sr-only">. {reason.long}</span>
          </p>
        ) : (
          range
        )}
      </div>
    </div>
  );
}

function PickerSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 px-1" aria-hidden>
      <span className="type-eyebrow">Window</span>
      <Skeleton height={28} radius={2} />
      <Skeleton height={28} radius={2} />
    </div>
  );
}

function ScreenMotion({ screen, children }: { screen: Screen; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      <motion.div key={screen} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DURATION.fast, ease: EASE.out }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function ReportTools({ help, setHelp, openPalette }: { help: boolean; setHelp: (h: boolean) => void; openPalette: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={openPalette}
        className="plain-button flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-sunken px-2.5 text-sm text-secondary transition-colors duration-(--duration-instant) hover:border-line-strong hover:text-primary"
      >
        <Search size={ICON.sm} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-start">Search this Report</span>
        <Key keys="/" />
      </button>
      <IconButton label="Help" tooltip="What the numbers mean, and every key (?)" variant={help ? "primary" : "ghost"} size="md" icon={<CircleHelp size={ICON.md} aria-hidden />} aria-pressed={help} onClick={() => setHelp(!help)} />
    </div>
  );
}

function Help({ ranged, span, filtered, screens, windowed }: { ranged: boolean; span: string; filtered: boolean; screens: number; windowed: boolean }) {
  return (
    <section aria-label="Help" className="fade mt-5 flex flex-col gap-3 rounded-lg border border-brand-line bg-surface p-panel text-sm">
      <p className="m-0 text-pretty">
        {windowed ? (
          <>
            Every number is over <strong>{ranged ? "the dates chosen" : (WINDOW_WORDS[span] ?? span)}</strong>
            {filtered ? ", and the filters chosen" : ""}.
          </>
        ) : (
          <>Code, branches and pull requests are read from git at the last Build, over the whole history, not over a Window.</>
        )}{" "}
        What each one means is now shown beneath it, and every key is ringed on screen.
      </p>
      <dl className="m-0 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {SHORTCUT_WORDS.map(([keys, words]) => (
          <div key={keys} className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
            <dt className="flex items-center gap-1 text-secondary">
              {keys === "1–9" ? (
                <>
                  <Key keys="1" /> to <Key keys={String(screens)} />
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
