import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { DateInput, type DateInputProps } from "@astryxdesign/core/DateInput";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Theme } from "@astryxdesign/core/theme";
import { ToastViewport } from "@astryxdesign/core/Toast";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { PRODUCT, type MapLevel, type Meta, type People as PeopleData } from "@commitscape/data";
import { TipLayer } from "./charts/Tip";
import { Key } from "./components/Key";
import { Logo } from "./components/Logo";
import { SaveCard } from "./components/SaveCard";
import { Share } from "./components/Share";
import { useData, useSource } from "./data";
import { WINDOW_WORDS } from "./format";
import { AvatarsContext, HelpContext } from "./help";
import { SHORTCUT_WORDS, useShortcuts } from "./keys";
import { Palette } from "./Palette";
import { paramsOf, SCREENS, TITLES, useRoute, type Route, type Screen } from "./route";
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

/**
 * Every screen, in its shell. The Site passes `home`, where the logo leads,
 * and `nav`, its own links beside the tools.
 */
export default function App({ home, nav }: { home?: string; nav?: ReactNode }) {
  const source = useSource();
  const [meta, setMeta] = useState<Meta | null>(source.meta);
  const [mode, setMode] = useMode();
  useEffect(() => source.listen(setMeta), [source]);
  return (
    <Theme theme={commitscapeTheme} mode={mode}>
      <ToastViewport>
        {meta ? (
          <Shell meta={meta} mode={mode} setMode={setMode} home={home} nav={nav} />
        ) : (
          <p className="waiting">Opening…</p>
        )}
      </ToastViewport>
    </Theme>
  );
}

function Shell({
  meta,
  mode,
  setMode,
  home,
  nav,
}: {
  meta: Meta;
  mode: Mode;
  setMode: (m: Mode) => void;
  home?: string;
  nav?: ReactNode;
}) {
  const source = useSource();
  const [route, go] = useRoute();
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
    // On Commits, `/` is its search; elsewhere, the palette.
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
          {meta.can_share && <Share />}
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
              <Filters meta={meta} route={route} go={go} window={span} />
              <Status meta={meta} />
              {help && <Help ranged={ranged} span={span} filtered={route.person !== undefined || !!route.folder} />}
              {route.screen === "overview" && <Overview {...props} />}
              {route.screen === "activity" && <Activity {...props} />}
              {route.screen === "people" && <People {...props} />}
              {route.screen === "map" && <MapScreen {...props} />}
              {route.screen === "risk" && <Risk {...props} />}
              {route.screen === "commits" && <Commits {...props} />}
              <footer className="note small">
                {source.kind === "report"
                  ? "A report written by commitscape: it holds only what it was written with."
                  : "Served by commitscape on this machine."}
              </footer>
            </div>
          </AppShell>
          <Palette isOpen={palette} onOpenChange={setPalette} meta={meta} window={span} go={go} />
        </TipLayer>
      </AvatarsContext>
    </HelpContext>
  );
}

/** What `?` shows above the screen: how to read it, and every key. */
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

function Status({ meta }: { meta: Meta }) {
  const busy = [
    meta.history === "loading" && "reading the rest of history",
    meta.lines === "counting" && "counting lines",
    meta.github === "asking" && "asking GitHub",
    meta.github_history.startsWith("reading") && `GitHub's history: ${meta.github_history}`,
  ].filter(Boolean);
  if (busy.length === 0) return null;
  return (
    <p className="status" role="status">
      {busy.join(", ")}…
    </p>
  );
}

type Iso = NonNullable<DateInputProps["value"]>;
const toIso = (d: number | undefined) => (d === undefined ? undefined : (new Date(d * 86_400_000).toISOString().slice(0, 10) as Iso));
const fromIso = (s: string | undefined) => (s ? Math.floor(Date.parse(`${s}T00:00:00Z`) / 86_400_000) : undefined);

/** One row of filters above every screen: a person, a folder, dates. */
function Filters({
  meta,
  route,
  go,
  window,
}: {
  meta: Meta;
  route: Route;
  go: (c: Partial<Route>, replace?: boolean) => void;
  window: string;
}) {
  const source = useSource();
  const isReport = source.kind === "report";
  // The lists are asked for when someone reaches for the filters, so they
  // never slow the screen's own first answer.
  const [wanted, setWanted] = useState(route.person !== undefined);
  const ask = wanted && !isReport;
  const people = useData<PeopleData>(ask ? "/api/people" : null, { window }, meta.generation);
  const folders = useData<MapLevel>(ask ? "/api/map" : null, { window }, meta.generation);
  if (isReport) {
    return <p className="note filters">Filters, dates and file details work in the live interface: commitscape --web.</p>;
  }
  const active = route.person !== undefined || route.folder || route.from !== undefined || route.to !== undefined;
  const chosen = route.person !== undefined ? String(route.person) : undefined;
  const options = (people.data?.people ?? []).slice(0, 200).map((p) => ({ value: String(p.person.id), label: p.person.name }));
  if (chosen !== undefined && !options.some((o) => o.value === chosen)) options.unshift({ value: chosen, label: "the person chosen" });
  const known = (folders.data?.children ?? [])
    .filter((b) => !b.file)
    .flatMap((b) => [b, ...b.inside.filter((c) => !c.file)])
    .map((b) => b.path);
  return (
    <div className="filters" onPointerEnter={() => setWanted(true)} onFocus={() => setWanted(true)}>
      <Selector
        label="Person"
        size="sm"
        hasSearch
        hasClear
        placeholder="everyone"
        value={chosen ?? null}
        onChange={(v: string | null) => go({ person: v ? Number(v) : undefined })}
        options={options}
        width={220}
      />
      <FolderInput key={route.folder ?? ""} folder={route.folder ?? ""} example={known[0]} go={go} />
      <DateInput label="From" size="sm" value={toIso(route.from)} onChange={(v) => go({ from: fromIso(v) })} hasClear width={170} />
      <DateInput label="To" size="sm" value={toIso(route.to)} onChange={(v) => go({ to: fromIso(v) })} hasClear width={170} />
      {active && (
        <Button
          label="Clear filters"
          variant="ghost"
          size="sm"
          onClick={() => go({ person: undefined, folder: undefined, from: undefined, to: undefined })}
        />
      )}
    </div>
  );
}

/**
 * The folder filter, typed and applied with Enter. A new one whenever the
 * route's folder changes, so it always starts from the filter in force.
 */
function FolderInput({ folder, example, go }: { folder: string; example?: string; go: (c: Partial<Route>) => void }) {
  const [typed, setTyped] = useState(folder);
  return (
    <TextInput
      label="Folder"
      size="sm"
      value={typed}
      placeholder={example ? `all of it, or ${example}` : "all of it"}
      onChange={(v) => {
        setTyped(v);
        if (v === "" && folder !== "") go({ folder: undefined });
      }}
      onEnter={() => go({ folder: typed || undefined })}
      hasClear
      width={220}
    />
  );
}
