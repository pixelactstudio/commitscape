import { useEffect, useState } from "react";
import { cardSvg, isReport, listen, servedMeta } from "./api/client";
import type { MapLevel, Meta, People as PeopleData } from "./api/types";
import { useData } from "./api/useData";
import { TipLayer } from "./charts/Tip";
import { HelpContext } from "./help";
import { WINDOW_WORDS } from "./format";
import { paramsOf, SCREENS, useRoute, type Route, type Screen } from "./route";
import { Activity } from "./screens/Activity";
import { MapScreen } from "./screens/Map";
import { Overview } from "./screens/Overview";
import { People } from "./screens/People";
import { Risk } from "./screens/Risk";
import { THEMES, useTheme } from "./theme";

const TITLES: Record<Screen, string> = {
  overview: "Overview",
  activity: "Activity",
  people: "People",
  map: "Map",
  risk: "Risk",
};

const WINDOW_BUTTONS: Record<string, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
  all: "All time",
};

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(servedMeta);
  const [route, go] = useRoute();
  const [help, setHelp] = useState(false);
  const [theme, setTheme] = useTheme();

  useEffect(() => listen(setMeta), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "?") setHelp((h) => !h);
      const n = Number(e.key);
      const screen = SCREENS[n - 1];
      if (screen && !e.ctrlKey && !e.metaKey && !e.altKey) go({ screen, id: undefined, file: undefined });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (!meta) return <p className="waiting">Opening…</p>;
  const params = paramsOf(route, meta);
  const span = route.window ?? meta.window;
  const ranged = route.from !== undefined || route.to !== undefined;
  const props = { meta, route, go, params };
  return (
    <HelpContext.Provider value={help}>
      <TipLayer>
        <div className="app">
          <header>
            <h1>{meta.name}</h1>
            <nav aria-label="Window" className="windows">
              {meta.windows.map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={!ranged && w === span}
                  onClick={() => go({ window: w, from: undefined, to: undefined })}
                >
                  {WINDOW_BUTTONS[w] ?? w}
                </button>
              ))}
            </nav>
            <div className="tools">
              <button type="button" aria-pressed={help} onClick={() => setHelp(!help)} title="What the numbers mean (?)">
                ?
              </button>
              <label>
                <span className="sr-only">Theme</span>
                <select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
                  {THEMES.map(([k, words]) => (
                    <option key={k} value={k}>
                      {words}
                    </option>
                  ))}
                </select>
              </label>
              <SaveCard name={meta.name} window={span} />
            </div>
          </header>
          <nav aria-label="Screens" className="screens">
            {SCREENS.map((s, i) => (
              <a
                key={s}
                href={`#/${s}`}
                aria-current={route.screen === s ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go({ screen: s, id: undefined, file: undefined });
                }}
              >
                <span className="key">{i + 1}</span> {TITLES[s]}
              </a>
            ))}
          </nav>
          <Filters meta={meta} route={route} go={go} window={span} />
          <Status meta={meta} />
          {help && (
            <p className="explain">
              Explanations are shown under every number. Press ? again to hide them; 1 to 5 change screens. Each number is
              over {ranged ? "the dates chosen" : WINDOW_WORDS[span] ?? span}
              {route.person !== undefined || route.folder ? ", and the filters above" : ""}.
            </p>
          )}
          {route.screen === "overview" && <Overview {...props} />}
          {route.screen === "activity" && <Activity {...props} />}
          {route.screen === "people" && <People {...props} />}
          {route.screen === "map" && <MapScreen {...props} />}
          {route.screen === "risk" && <Risk {...props} />}
          <footer className="note small">
            {isReport ? "A report written by commitscape: it holds only what it was written with." : "Served by commitscape on this machine."}
          </footer>
        </div>
      </TipLayer>
    </HelpContext.Provider>
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

const toDays = (s: string) => (s ? Math.floor(Date.parse(`${s}T00:00:00Z`) / 86_400_000) : undefined);
const fromDays = (d: number | undefined) => (d === undefined ? "" : new Date(d * 86_400_000).toISOString().slice(0, 10));

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
  return (
    <form
      className="filters"
      onPointerEnter={() => setWanted(true)}
      onFocus={() => setWanted(true)}
      onSubmit={(e) => {
        e.preventDefault();
        const typed = new FormData(e.currentTarget).get("folder");
        go({ folder: typeof typed === "string" && typed ? typed : undefined });
      }}
    >
      <label>
        Person{" "}
        <select
          value={route.person ?? ""}
          onChange={(e) => go({ person: e.target.value === "" ? undefined : Number(e.target.value) })}
        >
          <option value="">everyone</option>
          {route.person !== undefined && !people.data && <option value={route.person}>the person chosen</option>}
          {(people.data?.people ?? []).slice(0, 200).map((p) => (
            <option key={p.person.id} value={p.person.id}>
              {p.person.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Folder{" "}
        <input
          // A new input whenever the route's folder changes, so it always
          // shows the filter in force.
          key={route.folder ?? ""}
          name="folder"
          list="folders"
          defaultValue={route.folder ?? ""}
          placeholder="all of it"
          onBlur={(e) => {
            if (e.target.value !== (route.folder ?? "")) go({ folder: e.target.value || undefined });
          }}
          size={16}
        />
        <datalist id="folders">
          {(folders.data?.children ?? [])
            .filter((b) => !b.file)
            .flatMap((b) => [b, ...b.inside.filter((c) => !c.file)])
            .map((b) => (
              <option key={b.path} value={b.path} />
            ))}
        </datalist>
      </label>
      <label>
        From{" "}
        <input type="date" value={fromDays(route.from)} onChange={(e) => go({ from: toDays(e.target.value) })} />
      </label>
      <label>
        to <input type="date" value={fromDays(route.to)} onChange={(e) => go({ to: toDays(e.target.value) })} />
      </label>
      {active && (
        <button
          type="button"
          className="link"
          onClick={() => go({ person: undefined, folder: undefined, from: undefined, to: undefined })}
        >
          Clear filters
        </button>
      )}
    </form>
  );
}

/** Saves the card for the Window as a PNG, drawn from its SVG. */
function SaveCard({ name, window }: { name: string; window: string }) {
  const [state, setState] = useState<string | null>(null);
  const save = async () => {
    setState("Drawing…");
    try {
      const svg = await cardSvg(window);
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("The card could not be drawn."));
        img.src = url;
      });
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth * scale;
      canvas.height = img.naturalHeight * scale;
      const cx = canvas.getContext("2d");
      if (!cx) throw new Error("This browser cannot draw the card.");
      cx.scale(scale, scale);
      cx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!png) throw new Error("The card could not be saved.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(png);
      a.download = `${name}-card-${window}.png`;
      a.click();
      setState(null);
    } catch (e) {
      setState((e as Error).message);
    }
  };
  return (
    <>
      <button type="button" onClick={() => void save()}>
        Save the card
      </button>
      {state && <span className="note small">{state}</span>}
    </>
  );
}
