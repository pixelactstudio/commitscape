import { Selector } from "@astryxdesign/core/Selector";
import type { SelectorOptionType } from "@astryxdesign/core/Selector";
import { FolderGit2 } from "lucide-react";
import type { WorkItem } from "@commitscape/data";
import { many } from "../format";
import { placesOf } from "./helpers";

const ALL = "*";

/** A dropdown of the organisations and repositories in a Proof of Work, and "Everything". */
export function RepoPicker({ items, value, onChange, disabled = false }: { items: WorkItem[]; value: string | null; onChange: (filter: string | null) => void; disabled?: boolean }) {
  const { organisations, repositories } = placesOf(items);
  const known = !value || organisations.some((o) => o.name.toLowerCase() === value.toLowerCase()) || repositories.some((r) => r.name.toLowerCase() === value.toLowerCase());
  const options: SelectorOptionType[] = [
    { value: ALL, label: "Everything", description: many(items.length, "item", "items") },
    ...(!known && value ? [{ value, label: value, description: "nothing in this period" }] : []),
    ...(organisations.length > 1 ? [{ type: "section" as const, title: "Organisations and people", options: organisations.map((o) => ({ value: o.name, label: o.name, description: `${many(o.count, "item", "items")} in ${many(o.repositories, "repository", "repositories")}` })) }] : []),
    { type: "section" as const, title: "Repositories", options: repositories.map((r) => ({ value: r.name, label: r.name, description: many(r.count, "item", "items") })) },
  ];
  const match = value ? ([...organisations, ...repositories].find((p) => p.name.toLowerCase() === value.toLowerCase())?.name ?? value) : ALL;
  return (
    <div className="w-full sm:w-64">
    <Selector
      label="Only in"
      isLabelHidden
      options={options}
      value={match}
      onChange={(v) => onChange(v === ALL ? null : v)}
      startIcon={FolderGit2}
      hasSearch={repositories.length + organisations.length > 8}
      searchPlaceholder="Find a repository"
      isDisabled={disabled}
      width="100%"
      renderValue={(o) => <span className="truncate">{o.value === ALL ? "Every repository" : o.label}</span>}
    />
    </div>
  );
}
