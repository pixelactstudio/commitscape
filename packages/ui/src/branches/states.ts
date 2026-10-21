import { Archive, CircleDot, Clock, GitMerge, Tag, type LucideIcon } from "lucide-react";
import type { BranchState } from "@commitscape/data";

export type StateInfo = { id: BranchState; title: string; word: string; colour: string; Icon: LucideIcon };

export const STATES: Record<BranchState, StateInfo> = {
  flight: { id: "flight", title: "In flight", word: "In flight", colour: "var(--brand)", Icon: CircleDot },
  waiting: { id: "waiting", title: "Waiting", word: "Waiting", colour: "var(--s4)", Icon: Clock },
  abandoned: { id: "abandoned", title: "Abandoned", word: "Abandoned", colour: "var(--s2)", Icon: Archive },
  merged: { id: "merged", title: "Merged", word: "Merged", colour: "var(--s6)", Icon: GitMerge },
};

export const TAGS = { title: "Tags", colour: "var(--s1)", Icon: Tag } as const;

export const ORDER: readonly BranchState[] = ["flight", "waiting", "abandoned", "merged"];

/** What each state counts, in words that name the default branch. */
export function noteOf(state: BranchState, root: string): string {
  switch (state) {
    case "flight":
      return "Open pull request, or a commit within 30 days";
    case "waiting":
      return "No open pull request; quiet for 30 to 90 days";
    case "abandoned":
      return "No open pull request; quiet for over 90 days";
    case "merged":
      return `Safe to delete: already in ${root}, by merge, squash or rebase`;
  }
}
