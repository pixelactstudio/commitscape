import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ArrowDownUp, Search, Tag, Users } from "lucide-react";
import { Face } from "../components/Face";
import { ICON } from "../design/tokens";
import { grouped, many } from "../format";
import { Toolbar, ToolbarField } from "../kit/toolbar";
import { SORTS, type Author, type SortKey } from "./model";

type Props = {
  q: string;
  onQ: (q: string) => void;
  authors: Author[];
  who: string | undefined;
  onWho: (who: string | undefined) => void;
  prefixes: { prefix: string; count: number }[];
  prefix: string | undefined;
  onPrefix: (prefix: string | undefined) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  hideBots: boolean;
  onBots: (hide: boolean) => void;
  hidden: number;
  filtered: boolean;
  onClear: () => void;
};

const ICONS = { size: ICON.sm, strokeWidth: 1.75, absoluteStrokeWidth: true, "aria-hidden": true } as const;

/** Search, person, prefix, order and the switch that hides bots' branches. */
export function BranchToolbar(p: Props) {
  return (
    <Toolbar label="Filter the branches">
      <ToolbarField kind="search">
        <TextInput label="Search branches" isLabelHidden placeholder="Branch, person or pull request" value={p.q} onChange={p.onQ} hasClear width="100%" startIcon={<Search {...ICONS} />} />
      </ToolbarField>
      <ToolbarField kind="person">
        <Selector
          label="Person"
          isLabelHidden
          placeholder="Everyone"
          hasClear
          hasSearch
          searchPlaceholder="Find a person"
          emptySearchText="No one by that name has a branch here"
          width="100%"
          startIcon={<Users {...ICONS} />}
          value={p.who ?? null}
          onChange={(v: string | null) => p.onWho(v ?? undefined)}
          options={p.authors.map((a) => ({ value: a.key, label: a.name, description: many(a.count, "branch", "branches"), icon: <Face login={a.login} name={a.name} size={20} /> }))}
        />
      </ToolbarField>
      <ToolbarField kind="option">
        <Selector
          label="Prefix"
          isLabelHidden
          placeholder="Any prefix"
          hasClear
          hasSearch
          searchPlaceholder="Find a prefix"
          emptySearchText="No prefix like that"
          width="100%"
          startIcon={<Tag {...ICONS} />}
          value={p.prefix ?? null}
          onChange={(v: string | null) => p.onPrefix(v ?? undefined)}
          options={p.prefixes.map((x) => ({ value: x.prefix, label: x.prefix, description: many(x.count, "branch", "branches") }))}
        />
      </ToolbarField>
      <ToolbarField kind="order">
        <Selector label="Sort" isLabelHidden width="100%" startIcon={<ArrowDownUp {...ICONS} />} value={p.sort} onChange={(v: string | null) => p.onSort((SORTS.find((s) => s.value === v)?.value ?? "new") as SortKey)} options={SORTS.map((s) => ({ value: s.value, label: s.label }))} />
      </ToolbarField>
      <Switch size="sm" label={p.hideBots && p.hidden > 0 ? `Hide bots · ${grouped(p.hidden)} hidden` : "Hide bots"} value={p.hideBots} onChange={p.onBots} />
      {p.filtered && <Button label="Clear filters" variant="ghost" size="sm" onClick={p.onClear} />}
    </Toolbar>
  );
}
