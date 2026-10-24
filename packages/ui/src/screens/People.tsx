import { useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Bot } from "lucide-react";
import { RANKING_LIMIT, type People as Data } from "@commitscape/data";
import { pageHeading, useFocusOnChange } from "../components/focus";
import { Name } from "../components/Name";
import { useCounting, useData } from "../data";
import { ICON } from "../design/tokens";
import { Explain } from "../explain";
import { grouped, many } from "../format";
import { Panel } from "../kit/layout";
import { Toolbar, ToolbarField } from "../kit/toolbar";
import { EveryoneTable } from "../reading/people";
import { Profile } from "../reading/person";
import { BarList, EmptyWindow, Failed, ScreenFrame } from "./kit";
import { useReload } from "./reload";
import { openers, type ScreenProps } from "./props";

/** The people of a repository: everyone in the Window as a table you can sort and search, the Standings over all of history, and one person in full. */
export function People(props: ScreenProps & { extra?: ReactNode }) {
  const id = props.route.id;
  useFocusOnChange(id === undefined, () => (id === undefined ? pageHeading() : null));
  if (id !== undefined) return <Profile {...props} id={id} />;
  return <Everyone {...props} />;
}

function Everyone({ meta, route, params, go, extra }: ScreenProps & { extra?: ReactNode }) {
  const { data, error, stale } = useData<Data>("/api/people", params);
  const reload = useReload();
  const counting = useCounting();
  const [suspects, setSuspects] = useState(8);
  const open = openers(go, route);
  if (error || !data) return <Failed words={error} retry={reload} />;
  const standings = route.tab === "standings" && extra !== undefined;
  const lines = counting || data.people.some((r) => r.lines_added !== null);
  return (
    <ScreenFrame stale={stale}>
      {extra !== undefined && (
        <TabList value={standings ? "standings" : "everyone"} onChange={(v) => go({ tab: v === "standings" ? "standings" : undefined }, true)} size="md" hasDivider aria-label="What to show">
          <Tab value="everyone" label="Everyone" endContent={<span className="type-micro tnum">{grouped(data.people.length)}{data.people.length >= RANKING_LIMIT ? "+" : ""}</span>} />
          <Tab value="standings" label="Standings" />
        </TabList>
      )}
      {standings ? (
        <>
          <p className="m-0 type-description">Standings count the whole history of the repository and what GitHub knows of each person, so the Window chosen in the sidebar does not change them.</p>
          {extra}
        </>
      ) : (
        <>
          <EveryoneTable data={data} lines={lines} empty={<EmptyWindow window={data.window} what="Choose a longer Window to see who made them." go={go} />} onOpen={open.person} onCommits={(who) => open.commits({ who })} />
          {meta.lines !== "counted" && <p className="m-0 type-caption">Lines are {meta.lines === "counting" ? "being counted" : "not counted in this Report"}.</p>}
          {(data.suspects.length > 0 || data.bots.length > 0) && (
            <div className="grid items-start gap-gutter @min-[62rem]:grid-cols-2">
              {data.suspects.length > 0 && (
                <Panel title="May be one person" description="Names that look alike but were not joined: nothing strong enough links them.">
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {data.suspects.slice(0, suspects).map((g) => (
                      <li key={g.map((p) => p.id).join("-")} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line px-3 py-2 type-ui">
                        {g.map((p) => (
                          <Name key={p.id} p={p} onOpen={open.person} />
                        ))}
                      </li>
                    ))}
                  </ul>
                  {data.suspects.length > suspects && (
                    <div>
                      <Button label={`Show ${grouped(data.suspects.length - suspects)} more`} variant="ghost" size="sm" onClick={() => setSuspects(data.suspects.length)} />
                    </div>
                  )}
                  <Explain>To join them for good, add their lines to the repository’s .mailmap: each person’s page shows them.</Explain>
                </Panel>
              )}
              {data.bots.length > 0 && (
                <Panel title="Bots" description="Automation accounts, kept out of everyone else’s numbers">
                  <BarList
                    label="Bots by commits"
                    items={botsByName(data.bots).map((b) => ({
                      key: `${b.name}-${b.id}`,
                      label: b.accounts > 1 ? `${b.name} (${b.accounts} addresses)` : b.name,
                      lead: <Bot size={ICON.sm} className="flex-none text-secondary" aria-hidden />,
                      value: b.commits,
                      shown: many(b.commits, "commit", "commits"),
                      colour: "var(--other)",
                      onClick: () => open.person(b.id),
                    }))}
                  />
                </Panel>
              )}
            </div>
          )}
        </>
      )}
    </ScreenFrame>
  );
}

function botsByName(bots: Data["bots"]): { name: string; id: number; commits: number; accounts: number }[] {
  const by = new Map<string, { name: string; id: number; commits: number; accounts: number }>();
  for (const b of bots) {
    const seen = by.get(b.person.name);
    if (seen) {
      seen.commits += b.commits;
      seen.accounts += 1;
    } else {
      by.set(b.person.name, { name: b.person.name, id: b.person.id, commits: b.commits, accounts: 1 });
    }
  }
  return [...by.values()].sort((a, b) => b.commits - a.commits);
}

/** The People screen while its answer is fetched: the tabs, the search and rows of the height the real ones have. */
export function PeopleSkeleton() {
  return (
    <ScreenFrame label="Loading">
      <div className="box-content flex h-9 items-center gap-6 border-b border-separator" aria-hidden>
        <Skeleton height={16} width={88} radius={1} />
        <Skeleton height={16} width={72} radius={1} index={1} />
      </div>
      <div aria-hidden>
        <Toolbar label="Loading the search">
          <ToolbarField kind="search">
            <Skeleton height={32} index={1} />
          </ToolbarField>
        </Toolbar>
      </div>
      <section aria-busy="true" aria-label="Loading everyone" className="min-w-0 overflow-clip surface">
        <div className="flex h-10.5 items-center px-4 sm:px-5">
          <Skeleton height={14} width={160} radius={1} index={2} />
        </div>
        <div className="h-10 border-b border-separator" />
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-separator ps-4 pe-4 sm:ps-5 sm:pe-5" style={{ height: 60 }}>
            <Skeleton height={32} width={32} radius="rounded" index={i} />
            <span className="flex flex-1 flex-col gap-2">
              <Skeleton height={14} width={`${25 + ((i * 13) % 30)}%`} radius={1} index={i} />
              <Skeleton height={12} width="18%" radius={1} index={i} />
            </span>
            <Skeleton height={14} width={56} radius={1} index={i} />
          </div>
        ))}
      </section>
    </ScreenFrame>
  );
}
