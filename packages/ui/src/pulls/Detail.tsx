import { Button } from "@astryxdesign/core/Button";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { ICON } from "../design/tokens";
import { grouped } from "../format";
import { useGit } from "../git/source";
import type { Go, Route } from "../route";
import { Failed, ScreenFrame } from "../screens/kit";
import { CommitsTab } from "./CommitsTab";
import { FilesSkeleton, FilesTab } from "./FilesTab";
import { Head } from "./Head";
import { InsightsTab } from "./InsightsTab";
import { headerQuery, insightQuery, keptQuery } from "./queries";

const TABS = ["files", "commits", "conversation", "insights"] as const;

type TabId = (typeof TABS)[number];

const WORDS: Record<TabId, string> = { files: "Files", commits: "Commits", conversation: "Conversation", insights: "Insights" };

const tabOf = (tab: string | undefined): TabId => (TABS as readonly string[]).includes(tab ?? "") ? (tab as TabId) : "files";

/** One pull request as a view of its own: its header and timeline, then its files, commits, conversation and insights as tabs. */
export function PullDetail({ number, route, go }: { number: number; route: Route; go: Go }) {
  const git = useGit();
  const header = useQuery(headerQuery(git, number));
  const h = header.data;
  const tab = tabOf(route.tab);
  const kept = useQuery(keptQuery(git, number, h?.git === true && (tab === "files" || tab === "commits")));
  const insight = useQuery({ ...insightQuery(git, number), enabled: tab === "insights" });
  const back = git.href({ ...route, pr: undefined, tab: undefined, file: undefined });
  const all = () => go({ pr: undefined, tab: undefined, file: undefined });
  if (header.isError) {
    const missing = header.error instanceof Error && /No such pull request/.test(header.error.message);
    return (
      <Failed
        words={missing ? `There is no pull request ${number} among the ones read for this repository. It may be an issue, or newer than the last read.` : header.error instanceof Error ? header.error.message : "The pull request could not be read."}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button label="All pull requests" variant="secondary" onClick={all} />
            {missing ? <Button label={`Look for #${number} on GitHub`} variant="ghost" icon={<ExternalLink size={ICON.sm} aria-hidden />} href={`${git.github}/pull/${number}`} target="_blank" rel="noopener noreferrer" /> : <Button label="Try again" variant="ghost" onClick={() => void header.refetch()} />}
          </div>
        }
      />
    );
  }
  if (!h) return <PullDetailSkeleton />;
  const anchor = git.status.builtAt;
  return (
    <ScreenFrame>
      <Head h={h} back={back} github={git.github} anchor={Math.max(anchor, h.updatedAt)} />
      <div className="flex min-w-0 flex-col gap-3">
        <TabList value={tab} onChange={(v) => go({ tab: v === "files" ? undefined : v, file: undefined }, true)} role="tablist" hasDivider size="md" aria-label="Parts of the pull request">
          <Tab value="files" label={WORDS.files} panelId="pull-panel" endContent={h.changedFiles === null ? undefined : <span className="type-micro tnum">{grouped(h.changedFiles)}</span>} />
          <Tab value="commits" label={WORDS.commits} panelId="pull-panel" endContent={h.commits === null ? undefined : <span className="type-micro tnum">{grouped(h.commits)}</span>} />
          <Tab value="conversation" label={WORDS.conversation} panelId="pull-panel" endContent={h.comments === null ? undefined : <span className="type-micro tnum">{grouped(h.comments)}</span>} />
          <Tab value="insights" label={WORDS.insights} panelId="pull-panel" />
        </TabList>
        <div id="pull-panel" role="tabpanel" aria-label={WORDS[tab]} className="min-w-0">
          {tab === "files" && <FilesTab h={h} kept={kept} route={route} go={go} />}
          {tab === "commits" && <CommitsTab h={h} kept={kept} />}
          {tab === "conversation" && git.conversation(number)}
          {tab === "insights" && <InsightsTab h={h} route={route} insight={insight} anchor={Math.max(anchor, h.updatedAt)} />}
        </div>
      </div>
    </ScreenFrame>
  );
}

/** One pull request's view while its header is fetched, at the size it will be. */
export function PullDetailSkeleton() {
  return (
    <ScreenFrame label="Loading">
      <div className="flex min-w-0 flex-col gap-4 surface p-4 sm:p-5" aria-busy="true">
        <Skeleton height={16} width={120} radius={1} />
        <div className="grid min-w-0 gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <Skeleton height={24} width={120} radius={4} />
            <Skeleton height={29} width="62%" radius={2} />
            <Skeleton height={20} width="40%" radius={2} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} height={44} radius={2} index={i} />
              ))}
            </div>
            <Skeleton height={32} width={180} radius={2} />
          </div>
          <Skeleton height={236} radius={3} />
        </div>
      </div>
      <FilesSkeleton />
    </ScreenFrame>
  );
}
