import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Popover } from "@astryxdesign/core/Popover";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Switch } from "@astryxdesign/core/Switch";
import { FolderTree, Info, Map as MapIcon, Maximize, Minus, Plus, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { WEEK_SECONDS, type Described, type FolderFacts, type Found, type PersonFacts } from "@commitscape/data/universe";
import { codeLink } from "../code/address";
import { useSource } from "../data";
import { date, grouped, share } from "../format";
import { Nothing } from "../motion/Nothing";
import { NO_DRILL } from "../route";
import { camOf, camText, type Cam } from "../universe/camera";
import { useAnswer } from "../universe/answer";
import { useAtlas } from "../universe/client";
import { FrameRequester } from "../universe/frames";
import { Clock, SPEEDS } from "../universe/clock";
import { Feed } from "../universe/feed";
import { Flat } from "../universe/Flat";
import { LegendRow, Reading } from "../universe/Legend";
import { LENSES, type LensName } from "../universe/lenses";
import { lookOf, ROLE_NAMES, type Look } from "../universe/look";
import { FilePanel, FolderPanel, HoverCard, PersonPanel, type Who } from "../universe/Panels";
import type { FileAnswer, FolderAnswer, FrameAnswer, Summary } from "../universe/protocol";
import type { StageApi } from "../universe/Stage";
import { Timeline } from "../universe/Timeline";
import type { AtlasClient } from "../universe/client";
import type { ScreenProps } from "./props";

const Stage = lazy(() => import("../universe/Stage"));

const DAY = 86_400;
const STAGE = "relative h-(--main-height) min-h-120 overflow-hidden bg-sunken";
const INTRO_SECONDS = 2.8;

function webgl2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/** The Universe's layout while its history loads: the stage, its tools, the legend and the timeline where they will be. */
export function UniverseSkeleton({ words }: { words?: string }) {
  return (
    <div className={STAGE} aria-busy aria-label={words ?? "Loading the Universe"}>
      <div className="absolute top-3 right-14 left-3 flex flex-wrap items-center gap-2">
        <h1 tabIndex={-1} className="m-0 me-2 type-heading text-primary">Universe</h1>
        <Skeleton width={288} height={32} radius={3} />
        <Skeleton width={300} height={32} radius={3} />
      </div>
      <div className="absolute top-3 right-3 flex flex-col gap-2">
        <Skeleton width={32} height={32} radius={3} />
        <Skeleton width={32} height={32} radius={3} />
        <Skeleton width={32} height={32} radius={3} />
      </div>
      <div className="absolute inset-x-2 bottom-2 sm:inset-x-3 sm:bottom-3">
        <Skeleton height={132} radius={4} />
      </div>
      {words && <p className="absolute inset-x-0 top-1/2 m-0 -translate-y-1/2 text-center type-caption text-secondary">{words}</p>}
    </div>
  );
}

function Message({ title, words, action }: { title: string; words: ReactNode; action?: ReactNode }) {
  return (
    <div className={`${STAGE} flex items-center justify-center p-6`}>
      <h1 tabIndex={-1} className="absolute top-3 left-3 m-0 type-heading text-primary">Universe</h1>
      <Nothing title={title} words={words} action={action} />
    </div>
  );
}

const noop = () => () => undefined;

let canDraw: boolean | null = null;
function webgl(): boolean {
  canDraw ??= webgl2();
  return canDraw;
}

/** The repository's history as land: every file that was ever on the default branch is one hex of an archipelago laid out by folder, rising from the sea when born and sinking when deleted, coloured by who holds it, frosted where nobody has touched it, replayed commit by commit. */
export function UniverseScreen(props: ScreenProps) {
  const source = useSource();
  const gl = useSyncExternalStore(noop, webgl, () => null);
  const [attempt, setAttempt] = useState(0);
  const toMap = <Button label="Open the Map" variant="secondary" size="sm" icon={<Icon icon={FolderTree} size="sm" />} onClick={() => props.go({ screen: "map" })} />;
  if (!source.atlas) return <Message title="No history to replay here" words="The Universe replays the commits the Site keeps for the repositories it builds. This Report does not carry them; the Map shows its code at HEAD." action={toMap} />;
  if (gl === null) return <UniverseSkeleton />;
  return <Loaded key={attempt} url={source.atlas} gl={gl} retry={() => setAttempt((a) => a + 1)} {...props} />;
}

function Loaded({ url, gl, retry, ...props }: ScreenProps & { url: string; gl: boolean; retry: () => void }) {
  const atlas = useAtlas(url);
  if (atlas.phase === "loading") return <UniverseSkeleton words="Reading every commit on the default branch…" />;
  if (atlas.phase === "failed") return <Message title="The Universe could not be drawn" words={atlas.message} action={<Button label="Try again" variant="secondary" size="sm" icon={<Icon icon={RotateCcw} size="sm" />} onClick={retry} />} />;
  if (atlas.summary.count === 0) return <Message title="No files yet" words="The default branch has no commits that change a file, so there is no land to draw." />;
  return <Atlas {...props} summary={atlas.summary} client={atlas.client} names={atlas.names} gl={gl} />;
}

const DARK = "(prefers-color-scheme: dark)";

function watchTheme(changed: () => void): () => void {
  const media = window.matchMedia(DARK);
  media.addEventListener("change", changed);
  const watch = new MutationObserver(changed);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  return () => {
    media.removeEventListener("change", changed);
    watch.disconnect();
  };
}

const themeKey = () => `${document.documentElement.dataset.theme ?? ""}|${window.matchMedia(DARK).matches}`;

function useLook(): Look | null {
  const key = useSyncExternalStore(watchTheme, themeKey, () => "");
  return useMemo(() => (key ? lookOf(document.body) : null), [key]);
}

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (changed: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", changed);
      return () => m.removeEventListener("change", changed);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const LENS_INDEX: Record<LensName, number> = { holder: 0, role: 1, stale: 2, language: 3 };

type Inspect = { kind: "file"; rank: number } | { kind: "folder"; folder: number } | { kind: "person"; person: number } | null;

type Shown = { slots: number[]; tallest: number };

function Atlas({ route, go, summary, client, names, gl }: ScreenProps & { summary: Summary; client: AtlasClient; names: boolean; gl: boolean }) {
  const stageBox = useRef<HTMLDivElement>(null);
  const look = useLook();
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const narrow = useMedia("(max-width: 767px)");
  const [topView, setTopView] = useState(false);
  const top = narrow || topView;
  const [lost, setLost] = useState(false);
  const flat = !gl || lost;

  const first = summary.origin;
  const last = summary.newest;
  const [clock] = useState(() => new Clock(route.at !== undefined ? Math.max(first, Math.min(last, route.at * DAY + DAY - 1)) : last, first, last));
  useEffect(() => () => clock.pause(), [clock]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(SPEEDS[1].value);
  const [at, setAt] = useState(() => clock.at);
  const range = useMemo<[number, number] | null>(() => (route.since !== undefined && route.until !== undefined && route.until >= route.since ? [route.since * DAY, Math.min(last, route.until * DAY + DAY - 1)] : null), [route.since, route.until, last]);
  const lens: LensName = (LENSES.find((l) => l.value === route.lens)?.value ?? "holder") as LensName;
  const soloIndex = useMemo(() => {
    if (route.who === undefined) return null;
    const i = summary.people.id.indexOf(route.who);
    return i >= 0 ? i : null;
  }, [route.who, summary]);
  const [roleMask, setRoleMask] = useState(31);
  const [hideBots, setHideBots] = useState(true);
  const [strip, setStrip] = useState(summary.strip);
  const [shown, setShown] = useState<Shown>({ slots: [], tallest: 0 });
  const slots = shown.slots;
  const tallest = shown.tallest;
  const [feed] = useState(() => new Feed<FrameAnswer | null>(null));
  const [hoverFeed] = useState(() => new Feed<{ rank: number | null; x: number; y: number }>({ rank: null, x: 0, y: 0 }));
  const api = useRef<StageApi | null>(null);
  const dock = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(150);
  const [toolsHeight, setToolsHeight] = useState(32);
  useEffect(() => {
    const el = dock.current;
    const bar = tools.current;
    if (!el || !bar) return;
    const ro = new ResizeObserver(() => {
      setDockHeight(el.offsetHeight);
      setToolsHeight(bar.offsetHeight);
    });
    ro.observe(el);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [look]);
  const insets = useMemo(() => (narrow ? { top: toolsHeight + 20, right: 48, bottom: dockHeight + 16, left: 8 } : { top: toolsHeight + 24, right: 56, bottom: dockHeight + 24, left: 16 }), [narrow, dockHeight, toolsHeight]);
  const introDone = useRef(route.at !== undefined || route.since !== undefined || route.cam !== undefined || route.file !== undefined || route.folder !== undefined || route.who !== undefined);

  const who = useCallback(
    (p: number): Who => {
      const k = slots.indexOf(p);
      return { name: summary.people.names[p] ?? "Someone", login: summary.people.logins[p] ?? null, colour: k >= 0 && look ? (look.css.slots[k] ?? null) : null };
    },
    [summary, slots, look],
  );

  const [frames] = useState(() => {
    let last = 0;
    return new FrameRequester(client, clock, feed, first, (f) => {
      const now = performance.now();
      if (!clock.playing || now - last > 250) {
        last = now;
        setShown({ slots: f.slots, tallest: f.tallest });
      }
    });
  });
  useEffect(() => frames.start(), [frames]);

  useEffect(() => {
    if (range) clock.set(range[1]);
    frames.set({ from: range ? range[0] : null, to: range ? range[1] : null, solo: soloIndex });
  }, [range, soloIndex, frames, clock]);

  useEffect(() => {
    let last = 0;
    return clock.listen(() => {
      const c = clock.state.current;
      setPlaying(c.playing);
      const now = performance.now();
      if (!c.playing || now - last > 250) {
        last = now;
        setAt(c.at);
      }
    });
  }, [clock]);

  useEffect(() => {
    if (playing) return;
    const f = feed.value;
    const id = setTimeout(() => {
      if (f) setShown({ slots: f.slots, tallest: f.tallest });
      if (!introDone.current) return;
      const day = at >= last - 3600 ? undefined : Math.floor(at / DAY);
      if (route.at !== day) go({ at: day }, true);
    }, 350);
    return () => clearTimeout(id);
  }, [playing, at, feed, last, route.at, go]);

  useEffect(() => {
    void client.ask("bots", { hide: hideBots }).then((s) => {
      setStrip(s);
      frames.refresh();
    });
  }, [hideBots, client, frames]);

  const play = useCallback(() => {
    introDone.current = true;
    if (clock.playing) clock.pause();
    else {
      if (range) go({ since: undefined, until: undefined }, true);
      clock.speed(speed);
      clock.play(reduced);
    }
    api.current?.wake();
  }, [clock, speed, reduced, range, go]);

  const startIntro = useCallback(() => {
    if (introDone.current || reduced || flat) {
      introDone.current = true;
      return;
    }
    introDone.current = true;
    clock.set(first);
    clock.speed(Math.max(WEEK_SECONDS, (last - first) / INTRO_SECONDS));
    clock.atEnd(() => clock.speed(speed));
    clock.play(false, true);
    api.current?.intro(INTRO_SECONDS + 0.3);
  }, [clock, first, last, reduced, flat, speed]);

  useEffect(() => {
    if (flat) startIntro();
  }, [flat, startIntro]);

  const scrub = useCallback(
    (t: number, done: boolean) => {
      if (clock.playing) clock.pause();
      introDone.current = true;
      if (range && done) go({ since: undefined, until: undefined }, true);
      clock.set(t);
      api.current?.wake();
    },
    [clock, range, go],
  );

  const setRange = (r: [number, number] | null) => {
    clock.pause();
    introDone.current = true;
    go(r ? { since: Math.floor(r[0] / DAY), until: Math.floor(r[1] / DAY) } : { since: undefined, until: undefined }, true);
  };

  const jumpRelease = (dir: 1 | -1) => {
    const times = summary.releases.time;
    const now = clock.at;
    let target: number | null = null;
    if (times.length === 0) target = now + dir * 365.25 * DAY;
    else if (dir > 0) target = Array.from(times).find((t) => t > now + 60) ?? null;
    else target = Array.from(times).reverse().find((t) => t < now - 60) ?? null;
    if (target !== null) scrub(target, true);
  };

  const focus = useAnswer<{ folder: number; from: number; to: number } | null>(route.folder ? `folder:${route.folder}` : null, async () => {
    const folder = await client.ask("lookup", { kind: "folder", path: route.folder ?? "" });
    if (folder < 0) return null;
    const facts = await client.ask("folder", { folder, at: clock.at });
    return { folder, from: facts.from, to: facts.to };
  });
  const [picked, setPicked] = useState<{ path: string; rank: number } | null>(null);
  const looked = useAnswer<number>(route.file ? `file:${route.file}:${names}` : null, () => client.ask("lookup", { kind: "file", path: route.file ?? "" }));
  const selected = !route.file ? null : picked && picked.path === route.file ? picked.rank : looked !== null && looked >= 0 ? looked : null;

  const flewTo = useRef(route.cam !== undefined);
  useEffect(() => {
    if (selected === null || flewTo.current || !api.current) return;
    flewTo.current = true;
    api.current.fly(summary.x[selected] as number, summary.z[selected] as number, 12);
  }, [selected, summary]);

  const inspect = useMemo<Inspect>(() => (selected !== null ? { kind: "file", rank: selected } : soloIndex !== null ? { kind: "person", person: soloIndex } : focus ? { kind: "folder", folder: focus.folder } : null), [selected, soloIndex, focus]);

  const flyToFolder = useCallback(
    async (folder: number) => {
      const facts = await client.ask("folder", { folder, at: clock.at });
      api.current?.fly(facts.x, facts.z, facts.radius);
      return facts;
    },
    [client, clock],
  );

  const chooseFolder = useCallback(
    async (folder: number) => {
      const path = await client.ask("path", { kind: "folder", ref: folder });
      go({ folder: path || undefined, file: undefined }, true);
      void flyToFolder(folder);
    },
    [client, go, flyToFolder],
  );

  const chooseFile = useCallback(
    async (rank: number | null, fly = false) => {
      if (rank === null) {
        go({ file: undefined }, true);
        return;
      }
      const path = await client.ask("path", { kind: "file", ref: rank });
      setPicked({ path, rank });
      go({ file: path }, true);
      if (fly) api.current?.fly(summary.x[rank] as number, summary.z[rank] as number, 6);
    },
    [client, go, summary],
  );

  const choosePerson = useCallback(
    (p: number | null) => {
      go({ who: p === null ? undefined : summary.people.id[p], file: undefined }, true);
    },
    [go, summary],
  );

  const onPick = useCallback(
    (rank: number | null, double: boolean) => {
      if (rank === null) {
        if (!double) go({ file: undefined }, true);
        return;
      }
      if (double) {
        void client.ask("home", { rank }).then((place) => {
          void chooseFolder(place.folder);
        });
        return;
      }
      void chooseFile(rank);
    },
    [client, go, chooseFile, chooseFolder],
  );

  const camTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCam = useCallback(
    (c: Cam) => {
      if (camTimer.current) clearTimeout(camTimer.current);
      camTimer.current = setTimeout(() => go({ cam: camText(c) }, true), 500);
    },
    [go],
  );

  const described = useAnswer<Described>(playing ? null : `at:${Math.round(at)}`, () => client.ask("describe", { at: clock.at }), 200);
  const describedFolder = useAnswer<string>(described && described.folder !== null ? `folder:${described.folder}` : null, () => client.ask("path", { kind: "folder", ref: described?.folder ?? 0 })) ?? "";

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [role=listbox]")) return;
    if (target.closest("[role=radiogroup]") && e.key.startsWith("Arrow")) return;
    const onStage = target === stageBox.current;
    const k = e.key;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (k === " " || k === "k") {
      if (target.closest("button") && k === " ") return;
      handled();
      play();
    } else if (onStage && (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown")) {
      handled();
      const d = 60;
      api.current?.pan(k === "ArrowLeft" ? d : k === "ArrowRight" ? -d : 0, k === "ArrowUp" ? d : k === "ArrowDown" ? -d : 0);
    } else if (k === "ArrowLeft" || k === "ArrowRight") {
      handled();
      scrub(clock.at + (k === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 30.44 * DAY : WEEK_SECONDS), true);
    } else if (k === "[" || k === "]") {
      handled();
      jumpRelease(k === "]" ? 1 : -1);
    } else if (k === "Home" || k === "End") {
      handled();
      scrub(k === "Home" ? first : last, true);
    } else if (k === "q" || k === "e") {
      handled();
      api.current?.turn(k === "q" ? 0.2 : -0.2);
    } else if (k === "r" || k === "f") {
      handled();
      api.current?.tilt(k === "r" ? 0.12 : -0.12);
    } else if (k === "+" || k === "=" || k === "-") {
      handled();
      api.current?.zoom(k === "-" ? 1.3 : 1 / 1.3);
    } else if (k === "0") {
      handled();
      api.current?.home();
    } else if (k === "Escape") {
      if (inspect?.kind === "person") {
        handled();
        choosePerson(null);
      } else if (inspect?.kind === "folder") {
        handled();
        go({ folder: undefined }, true);
      }
    }
  };

  const avatars = useCallback((p: number) => ({ name: summary.people.names[p] ?? "Someone", login: summary.people.logins[p] ?? null }), [summary]);
  const solo = soloIndex;
  const focusRange = useMemo<[number, number] | null>(() => (focus && focus.from >= 0 ? [focus.from, focus.to] : null), [focus]);
  const lensIndex = LENS_INDEX[lens];

  return (
    <section className={STAGE} aria-label="The Universe: every file the default branch ever had, as land, over time" onKeyDown={onKey}>
      <Toolbar bar={tools} reading={<Reading tallest={tallest} range={range} mainline={summary.mainline} commits={summary.commits} files={summary.count} />} client={client} names={names} lens={lens} onLens={(l) => go({ lens: l === "holder" ? undefined : l }, true)} roleMask={roleMask} onRoles={setRoleMask} hideBots={hideBots} onBots={setHideBots} narrow={narrow} onFound={(f) => {
        if (f.kind === "person") choosePerson(f.id);
        else if (f.kind === "folder") void chooseFolder(f.id);
        else void client.ask("lookup", { kind: "file", path: f.label }).then((rank) => {
          if (rank >= 0) void chooseFile(rank, true);
        });
      }} />
      <div
        ref={stageBox}
        tabIndex={0}
        className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--color-border-focus) focus-visible:outline-solid"
        aria-label="The map. Drag to move, right-drag to turn, scroll to zoom; arrow keys move, Q and E turn, R and F tilt, plus and minus zoom, 0 shows everything. Space plays."
        aria-describedby="atlas-moment"
      >
        {look &&
          (flat ? (
            <Flat summary={summary} feed={feed} look={look} lens={lensIndex} focus={focusRange} roleMask={roleMask} selected={selected} at={at} insets={insets} onHover={(rank, x, y) => hoverFeed.set({ rank, x, y })} onPick={onPick} />
          ) : (
            <Suspense fallback={<Skeleton height="100%" radius={4} />}>
              <Stage
                summary={summary}
                feed={feed}
                clock={clock.state}
                look={look}
                lens={lensIndex}
                focus={focusRange}
                roleMask={roleMask}
                selected={selected}
                soloSlot={solo !== null && slots.indexOf(solo) >= 0 ? slots.indexOf(solo) : null}
                top={top}
                reduced={reduced}
                initialCam={camOf(route.cam)}
                insets={insets}
                avatars={avatars}
                onHover={(rank, x, y) => hoverFeed.set({ rank, x, y })}
                onPick={onPick}
                onFolder={(f) => void chooseFolder(f)}
                onPerson={(p) => choosePerson(p === solo ? null : p)}
                onCam={onCam}
                onApi={(a) => {
                  const fresh = api.current === null;
                  api.current = a;
                  if (fresh) startIntro();
                }}
                onLost={() => setLost(true)}
              />
            </Suspense>
          ))}
      </div>
      <HoverLayer feed={hoverFeed} client={client} clock={clock} range={range} who={who} box={stageBox} hidden={inspect?.kind === "file" && narrow} />
      {!flat && (
        <div data-atlas-cover className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
          <IconButton label="Show the whole map (0)" size="sm" variant="secondary" icon={<Icon icon={Maximize} size="sm" />} onClick={() => api.current?.home()} />
          <IconButton label="Come closer (+)" size="sm" variant="secondary" icon={<Icon icon={Plus} size="sm" />} onClick={() => api.current?.zoom(1 / 1.4)} />
          <IconButton label="Step back (−)" size="sm" variant="secondary" icon={<Icon icon={Minus} size="sm" />} onClick={() => api.current?.zoom(1.4)} />
          {!narrow && <IconButton label={topView ? "Tilt the map" : "Look straight down"} size="sm" variant={topView ? "primary" : "secondary"} icon={<Icon icon={MapIcon} size="sm" />} onClick={() => setTopView((t) => !t)} />}
        </div>
      )}
      {inspect && (
        <div data-atlas-cover className={narrow ? "absolute inset-x-2 z-20 flex max-h-[55%] min-h-0" : "absolute right-14 z-20 flex w-84 min-h-0 items-start"} style={{ top: narrow ? undefined : toolsHeight + 20, bottom: dockHeight + 16 }}>
          <Inspector inspect={inspect} client={client} at={range ? range[1] : at} range={range} who={who} solo={solo} focus={focus?.folder ?? null} look={look} slots={slots} route={route} go={go} onClose={() => {
            if (inspect.kind === "file") go({ file: undefined }, true);
            else if (inspect.kind === "person") choosePerson(null);
            else go({ folder: undefined }, true);
          }} onPerson={(p) => choosePerson(p)} onFolder={(f) => void chooseFolder(f)} />
        </div>
      )}
      {look && (
        <div data-atlas-cover ref={dock} className="absolute inset-x-2 bottom-2 z-10 sm:inset-x-3 sm:bottom-3">
          <Timeline
            summary={summary}
            strip={strip}
            look={look}
            clock={clock}
            playing={playing}
            ready
            speed={speed}
            range={range}
            compact={narrow}
            name={(p) => summary.people.names[p] ?? "Someone"}
            onPlay={play}
            onSpeed={(s) => {
              setSpeed(s);
              clock.speed(s);
            }}
            onRange={setRange}
            onScrub={scrub}
            note={described && <MomentLine d={described} folder={describedFolder} who={who} />}
            legend={<LegendRow lens={lens} look={look} slots={slots} who={who} at={range ? range[1] : at} range={range} languages={summary.languages} solo={solo} onPerson={(p) => choosePerson(p === solo ? null : p)} narrow={narrow} />}
          />
        </div>
      )}
      <p id="atlas-moment" className="sr-only" aria-live="polite">
        {described && !playing ? momentWords(described, describedFolder, who) : ""}
      </p>
    </section>
  );
}

function momentWords(d: Described, folder: string, who: (p: number) => Who): string {
  const parts = [`${date(d.at)}: ${grouped(d.alive)} files alive`, `${share(d.frozen, d.alive)} untouched for a year`];
  if (d.folder !== null && folder) parts.push(`most commits in the 30 days before in ${folder}/ (${grouped(d.folderCommits)}${d.person !== null ? `; most by ${who(d.person).name}, ${grouped(d.personCommits)}` : ""})`);
  else parts.push(`${grouped(d.month)} commits in the 30 days before`);
  return parts.join("; ");
}

function MomentLine({ d, folder, who }: { d: Described; folder: string; who: (p: number) => Who }) {
  return (
    <>
      <span className="font-semibold text-primary tabular-nums">{grouped(d.alive)}</span> files alive · <span className="font-semibold text-primary tabular-nums">{share(d.frozen, d.alive)}</span> untouched for a year ·{" "}
      {d.folder !== null && folder ? (
        <>
          busiest: <span className="mono text-primary">{folder}/</span> ({grouped(d.folderCommits)} commits in 30 days{d.person !== null ? `, most by ${who(d.person).name}` : ""})
        </>
      ) : (
        <>{grouped(d.month)} commits in the 30 days before</>
      )}
    </>
  );
}

function HoverLayer({ feed, client, clock, range, who, box, hidden }: { feed: Feed<{ rank: number | null; x: number; y: number }>; client: AtlasClient; clock: Clock; range: [number, number] | null; who: (p: number) => Who; box: React.RefObject<HTMLDivElement | null>; hidden: boolean }) {
  const [state, setState] = useState<{ rank: number | null; x: number; y: number }>({ rank: null, x: 0, y: 0 });
  useEffect(() => feed.listen((v) => setState((s) => (s.rank === v.rank && Math.abs(s.x - v.x) < 1 && Math.abs(s.y - v.y) < 1 ? s : v))), [feed]);
  const atNow = range ? range[1] : clock.at;
  const facts = useAnswer<FileAnswer>(state.rank === null ? null : `${state.rank}@${Math.round(atNow)}`, () => client.ask("file", { rank: state.rank ?? 0, at: atNow }), 40, String(state.rank));
  if (state.rank === null || hidden) return null;
  const w = box.current?.clientWidth ?? 800;
  const h = box.current?.clientHeight ?? 600;
  return <HoverCard facts={facts} at={range ? range[1] : clock.at} range={range} who={who} x={state.x} y={state.y} width={w} height={h} />;
}

function Toolbar({ bar, reading, client, names, lens, onLens, roleMask, onRoles, hideBots, onBots, narrow, onFound }: { bar: React.RefObject<HTMLDivElement | null>; reading: ReactNode; client: AtlasClient; names: boolean; lens: LensName; onLens: (l: LensName) => void; roleMask: number; onRoles: (m: number) => void; hideBots: boolean; onBots: (b: boolean) => void; narrow: boolean; onFound: (f: Found) => void }) {
  const [filters, setFilters] = useState(false);
  const filtersBody = (
    <div className="flex w-60 flex-col gap-3 p-3">
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1 type-label text-primary">Show files that are</legend>
        {ROLE_NAMES.map((name, i) => (
          <CheckboxInput key={name} size="sm" label={name} value={((roleMask >> i) & 1) === 1} onChange={(on) => onRoles(on ? roleMask | (1 << i) : roleMask & ~(1 << i))} />
        ))}
      </fieldset>
      <Switch size="sm" label="Leave out Bots' commits" value={hideBots} onChange={onBots} />
      {(roleMask !== 31 || !hideBots) && (
        <Button
          label="Reset"
          size="sm"
          variant="ghost"
          onClick={() => {
            onRoles(31);
            onBots(true);
          }}
        />
      )}
    </div>
  );
  const changed = roleMask !== 31 || !hideBots;
  const [about, setAbout] = useState(false);
  return (
    <div ref={bar} data-atlas-cover className="pointer-events-none absolute top-3 right-14 left-3 z-20 flex flex-wrap items-center gap-2">
      <div className="pointer-events-auto flex h-8 flex-none items-center gap-0.5 pe-1">
        <h1 tabIndex={-1} className="m-0 type-heading text-primary outline-offset-4">
          Universe
        </h1>
        <Popover label="How to read the Universe" isOpen={about} onOpenChange={setAbout} content={reading} padding={0} placement="below" alignment="start">
          <IconButton label="How to read the Universe" size="sm" variant="ghost" icon={<Icon icon={Info} size="sm" />} />
        </Popover>
      </div>
      <div className="pointer-events-auto order-last w-full sm:order-none sm:w-72">
        <SearchBox client={client} names={names} narrow={narrow} onFound={onFound} />
      </div>
      <div className="pointer-events-auto rounded-md bg-surface/90 shadow-(--shadow-sm) backdrop-blur-md">
        {narrow ? (
          <Selector label="Colour by" isLabelHidden size="sm" value={lens} onChange={(v) => onLens(v as LensName)} options={LENSES.map((l) => ({ value: l.value, label: l.label }))} width={136} />
        ) : (
          <SegmentedControl label="Colour the land by" size="sm" value={lens} onChange={(v) => onLens(v as LensName)}>
            {LENSES.map((l) => (
              <SegmentedControlItem key={l.value} value={l.value} label={l.label} />
            ))}
          </SegmentedControl>
        )}
      </div>
      <div className="pointer-events-auto">
        <Popover label="Filters" isOpen={filters} onOpenChange={setFilters} content={filtersBody} padding={0} placement="below" alignment="start">
          {narrow ? <IconButton label={changed ? "Filters, on" : "Filters"} size="sm" variant={changed ? "primary" : "secondary"} icon={<Icon icon={SlidersHorizontal} size="sm" />} /> : <Button label={changed ? "Filters · on" : "Filters"} size="sm" variant={changed ? "primary" : "secondary"} icon={<Icon icon={SlidersHorizontal} size="sm" />} />}
        </Popover>
      </div>
    </div>
  );
}

function SearchBox({ client, names, narrow, onFound }: { client: AtlasClient; names: boolean; narrow: boolean; onFound: (f: Found) => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const list = useId();
  const found = useAnswer<Found[]>(q.trim() ? `${q}|${names}` : null, () => client.ask("search", { q }), 90) ?? [];
  const pick = (f: Found | undefined) => {
    if (!f) return;
    onFound(f);
    setQ("");
    setOpen(false);
  };
  const shown = open && found.length > 0;
  return (
    <div className="relative">
      <div className="flex h-8 items-center gap-2 rounded-md bg-surface/90 px-2.5 shadow-(--shadow-sm) backdrop-blur-md focus-within:outline-2 focus-within:outline-(--color-border-focus)">
        <Search size={14} className="flex-none text-secondary" aria-hidden />
        <input
          type="search"
          role="combobox"
          aria-expanded={shown}
          aria-controls={list}
          aria-activedescendant={shown ? `${list}-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Find a file, folder or person and fly there"
          placeholder={narrow ? "Search the map" : names ? "Find a file, folder or person" : "Find a folder or person"}
          className="min-w-0 flex-1 border-0 bg-transparent type-ui text-primary outline-none placeholder:text-tertiary"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(found.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(found[active]);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setQ("");
              setOpen(false);
            }
          }}
        />
      </div>
      {shown && (
        <ul id={list} role="listbox" aria-label="Places found" className="absolute top-full left-0 z-30 m-0 mt-1 max-h-96 w-[min(30rem,calc(100vw-2rem))] list-none overflow-y-auto rounded-md bg-surface p-1 shadow-(--shadow-lg)">
          {found.map((f, i) => {
            const cut = f.kind === "person" ? -1 : f.label.replace(/\/$/, "").lastIndexOf("/");
            const name = cut < 0 ? f.label : f.label.slice(cut + 1);
            const where = cut < 0 ? "" : f.label.slice(0, cut + 1);
            return (
              <li
                key={`${f.kind}-${f.id}`}
                id={`${list}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`grid cursor-pointer grid-cols-[3.5rem_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-sm px-2 py-1.5 ${i === active ? "bg-active" : "hover:bg-hover"}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(f);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="type-caption text-tertiary">{f.kind === "person" ? "Person" : f.kind === "folder" ? "Folder" : "File"}</span>
                <span className="flex min-w-0 flex-col">
                  <span className={`truncate type-ui text-primary ${f.kind === "person" ? "" : "mono"}`}>{name}</span>
                  {where && <span className="truncate mono type-caption text-secondary">{where}</span>}
                </span>
                {f.detail && <span className="type-caption text-secondary">{f.detail}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Inspector({ inspect, client, at, range, who, solo, focus, look, slots, route, go, onClose, onPerson, onFolder }: { inspect: NonNullable<Inspect>; client: AtlasClient; at: number; range: [number, number] | null; who: (p: number) => Who; solo: number | null; focus: number | null; look: Look | null; slots: number[]; route: ScreenProps["route"]; go: ScreenProps["go"]; onClose: () => void; onPerson: (p: number) => void; onFolder: (f: number) => void }) {
  const ref = inspect.kind === "file" ? inspect.rank : inspect.kind === "folder" ? inspect.folder : inspect.person;
  const key = `${inspect.kind}:${ref}@${Math.round(at)}`;
  const keep = `${inspect.kind}:${ref}`;
  const file = useAnswer<FileAnswer>(inspect.kind === "file" ? key : null, () => client.ask("file", { rank: ref, at }), 60, keep);
  const folder = useAnswer<FolderAnswer>(inspect.kind === "folder" ? key : null, () => client.ask("folder", { folder: ref, at }), 60, keep);
  const person = useAnswer<PersonFacts>(inspect.kind === "person" ? key : null, () => client.ask("person", { person: ref, at }), 60, keep);
  const yearFrom = Math.floor((range ? range[0] : at - 365 * DAY) / DAY);
  const yearTo = Math.floor(at / DAY);
  if (inspect.kind === "file")
    return (
      <FilePanel
        facts={file}
        at={at}
        range={range}
        who={who}
        onClose={onClose}
        onPerson={onPerson}
        onCode={() => file && go(codeLink(route, file.path))}
        onCommits={() => file && go({ screen: "commits", ...NO_DRILL, window: "all", under: file.path, file: undefined })}
        onMap={() => file && go({ screen: "map", path: file.path.slice(0, file.path.lastIndexOf("/") + 1), file: file.path })}
      />
    );
  if (inspect.kind === "folder")
    return (
      <FolderPanel
        facts={folder as FolderFacts | null}
        at={at}
        who={who}
        onClose={onClose}
        onPerson={onPerson}
        focused={focus === inspect.folder}
        onFocus={() => (focus === inspect.folder ? go({ folder: undefined }, true) : onFolder(inspect.folder))}
        onMap={() => folder && go({ screen: "map", path: folder.path ? `${folder.path}/` : "", file: undefined })}
        onCommits={() => folder && go({ screen: "commits", ...NO_DRILL, window: "all", under: folder.path ? `${folder.path}/` : undefined, since: yearFrom, until: yearTo, file: undefined })}
      />
    );
  const k = slots.indexOf(inspect.person);
  const w = who(inspect.person);
  return (
    <PersonPanel
      facts={person}
      at={at}
      who={w}
      colour={k >= 0 && look ? (look.css.slots[k] ?? null) : null}
      solo={solo === inspect.person}
      onClose={onClose}
      onSolo={onClose}
      onPeople={route.who === undefined ? null : () => go({ screen: "people", id: route.who })}
      onFolder={onFolder}
    />
  );
}
