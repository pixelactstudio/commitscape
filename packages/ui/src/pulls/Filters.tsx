import { useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Typeahead } from "@astryxdesign/core/Typeahead";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownUp, Gauge, MessageSquareText, Ruler, Search, SlidersHorizontal, Tag, User } from "lucide-react";
import { PULL_SIZES, type PullLabel, type PullState } from "@commitscape/data";
import { Face } from "../components/Face";
import { ICON } from "../design/tokens";
import { compact, grouped, many } from "../format";
import { gitKey, useGit } from "../git/source";
import { Toolbar, ToolbarField } from "../kit/toolbar";
import { useLeading } from "../leading";
import { SIZE_WORDS, sortsOf, TAB_WORDS } from "./model";

const ICONS = { size: ICON.sm, strokeWidth: 1.75, absoluteStrokeWidth: true, "aria-hidden": true } as const;

type Item = { id: string; label: string; auxiliaryData?: { pulls: number } };

const REVIEWS = [
  { value: "none", label: "No review" },
  { value: "reviewed", label: "Reviewed" },
  { value: "approved", label: "Approved" },
  { value: "changes", label: "Changes requested" },
];

export type Chosen = { author: string | undefined; label: string | undefined; size: string | undefined; review: string | undefined; draft: string | undefined; stale: boolean; sort: string; q: string };

type Props = {
  tab: PullState;
  counts: Record<PullState, number> | undefined;
  chosen: Chosen;
  labels: (PullLabel & { pulls: number })[];
  filtered: boolean;
  onTab: (tab: PullState) => void;
  onChange: (change: Partial<Record<keyof Chosen, string | boolean | undefined>>) => void;
  onClear: () => void;
};

function AuthorFilter({ login, onChange }: { login: string | undefined; onChange: (login: string | undefined) => void }) {
  const git = useGit();
  const queries = useQueryClient();
  const source = useMemo(() => {
    const ask = (q: string): Promise<Item[]> =>
      queries
        .fetchQuery({ queryKey: gitKey(git, "pull-authors", q.trim().toLowerCase()), queryFn: () => git.pullAuthors(q.trim()), staleTime: 5 * 60_000 })
        .then((list) => list.map((a) => ({ id: a.login, label: a.login, auxiliaryData: { pulls: a.pulls } })))
        .catch(() => []);
    return { search: ask, bootstrap: () => ask("") };
  }, [git, queries]);
  return (
    <Typeahead<Item>
      label="Author"
      isLabelHidden
      size="md"
      width="100%"
      placeholder="Anyone"
      startIcon={<User {...ICONS} />}
      searchSource={source}
      value={login ? { id: login, label: login } : null}
      onChange={(item) => onChange(item?.id)}
      hasEntriesOnFocus
      minQueryLength={0}
      maxMenuItems={8}
      emptySearchText="No one by that name opened a pull request here"
      renderItem={(item) => (
        <span className="flex w-full min-w-0 items-center gap-2">
          <Face login={item.label} name={item.label} size={20} />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.auxiliaryData && <span className="flex-none type-micro tnum">{many(item.auxiliaryData.pulls, "pull request", "pull requests")}</span>}
        </span>
      )}
    />
  );
}

function chosenCount(c: Chosen): number {
  return [c.size, c.review, c.draft].filter(Boolean).length + (c.stale ? 1 : 0);
}

/** The state tabs with the number of pull requests in each. */
export function PullTabs({ tab, counts, onTab }: Pick<Props, "tab" | "counts" | "onTab">) {
  return (
    <TabList value={tab} onChange={(v) => onTab(v as PullState)} role="tablist" hasDivider size="md" aria-label="Pull requests by state">
      {(["open", "merged", "closed"] as const).map((t) => (
        <Tab key={t} value={t} label={TAB_WORDS[t]} panelId="pull-list" endContent={<span className="type-micro tnum" title={counts ? many(counts[t], "pull request", "pull requests") : undefined}>{counts ? (counts[t] >= 10_000 ? compact(counts[t]) : grouped(counts[t])) : "—"}</span>} />
      ))}
    </TabList>
  );
}

/** A search for a title or a #number, the author, label and order that matter most, and a button that brings out size, review, draft and idleness. */
export function PullToolbar({ tab, chosen, labels, filtered, onChange, onClear }: Omit<Props, "counts" | "onTab">) {
  const [text, setText] = useState(chosen.q);
  const [seen, setSeen] = useState(chosen.q);
  const hidden = chosenCount(chosen);
  const [more, setMore] = useState(hidden > 0);
  if (chosen.q !== seen) {
    setSeen(chosen.q);
    setText(chosen.q);
  }
  const search = useLeading((v: string) => onChange({ q: v.trim() || undefined }), 250);
  const sorts = sortsOf(tab);
  return (
    <div className="flex flex-col gap-2">
      <Toolbar label="Filter the pull requests">
        <ToolbarField kind="search">
          <TextInput
            label="Search pull requests"
            isLabelHidden
            placeholder="Title, or #number"
            value={text}
            onChange={(v) => {
              setText(v);
              search(v);
            }}
            hasClear
            width="100%"
            startIcon={<Search {...ICONS} />}
          />
        </ToolbarField>
        <ToolbarField kind="person">
          <AuthorFilter login={chosen.author} onChange={(author) => onChange({ author })} />
        </ToolbarField>
        <ToolbarField kind="option">
          <Selector
            label="Label"
            isLabelHidden
            placeholder="Any label"
            hasClear
            hasSearch
            searchPlaceholder="Find a label"
            emptySearchText="No label like that"
            width="100%"
            startIcon={<Tag {...ICONS} />}
            value={chosen.label ?? null}
            onChange={(v: string | null) => onChange({ label: v ?? undefined })}
            options={[...(chosen.label && !labels.some((l) => l.name === chosen.label) ? [{ name: chosen.label, colour: "", pulls: 0 }] : []), ...labels].map((l) => ({ value: l.name, label: l.name, description: l.pulls > 0 ? many(l.pulls, "pull request", "pull requests") : undefined }))}
          />
        </ToolbarField>
        <Button
          label={hidden > 0 ? `More filters · ${hidden}` : "More filters"}
          variant="secondary"
          size="md"
          icon={<SlidersHorizontal {...ICONS} />}
          aria-expanded={more}
          aria-controls="pull-more-filters"
          onClick={() => setMore((v) => !v)}
        />
        <ToolbarField kind="option">
          <Selector label="Order" isLabelHidden width="100%" startIcon={<ArrowDownUp {...ICONS} />} value={chosen.sort} onChange={(v: string | null) => onChange({ sort: v ?? "" })} options={sorts} />
        </ToolbarField>
        {filtered && <Button label="Clear filters" variant="ghost" size="sm" onClick={onClear} />}
      </Toolbar>
      <div id="pull-more-filters" hidden={!more}>
        <Toolbar label="More ways to filter the pull requests">
          <ToolbarField kind="option">
            <Selector
              label="Size"
              isLabelHidden
              placeholder="Any size"
              hasClear
              width="100%"
              startIcon={<Ruler {...ICONS} />}
              value={chosen.size ?? null}
              onChange={(v: string | null) => onChange({ size: v ?? undefined })}
              options={PULL_SIZES.map((s) => ({ value: s.id, label: s.label, description: SIZE_WORDS[s.id] }))}
            />
          </ToolbarField>
          <ToolbarField kind="option">
            <Selector label="Review" isLabelHidden placeholder="Any review" hasClear width="100%" startIcon={<MessageSquareText {...ICONS} />} value={chosen.review ?? null} onChange={(v: string | null) => onChange({ review: v ?? undefined })} options={REVIEWS} />
          </ToolbarField>
          <ToolbarField kind="person">
            <Selector
              label="Draft"
              isLabelHidden
              placeholder="Draft or not"
              hasClear
              width="100%"
              startIcon={<Gauge {...ICONS} />}
              value={chosen.draft ?? null}
              onChange={(v: string | null) => onChange({ draft: v ?? undefined })}
              options={[
                { value: "yes", label: "Drafts only" },
                { value: "no", label: "Ready for review" },
              ]}
            />
          </ToolbarField>
          <Switch size="sm" label="Idle over 90 days" value={chosen.stale} onChange={(v) => onChange({ stale: v })} />
        </Toolbar>
      </div>
    </div>
  );
}
