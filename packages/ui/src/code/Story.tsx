import type { ReactNode } from "react";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import type { CodeStory, PersonRef } from "@commitscape/data";
import { Face } from "../components/Face";
import { useLogin } from "../components/login";
import { date, grouped, many, share } from "../format";
import { bytes } from "../git/insights";
import { stalenessOf } from "./data";

const DAY = 86_400;

function Fact({ label, value, sub, title }: { label: string; value: ReactNode; sub?: ReactNode; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-2.5" title={title}>
      <dt className="type-micro whitespace-nowrap text-tertiary">{label}</dt>
      <dd className="m-0 flex flex-col gap-0.5">
        <span className="text-sm font-semibold whitespace-nowrap text-primary tnum">{value}</span>
        {sub && <span className="flex items-center gap-1.5 type-micro whitespace-nowrap">{sub}</span>}
      </dd>
    </div>
  );
}

function Who({ p }: { p: PersonRef | null }) {
  const login = useLogin(p);
  if (!p) return <span>someone unknown</span>;
  return (
    <>
      <Face login={login} name={p.name} size={16} />
      <span className="max-w-40 truncate">{p.name}</span>
    </>
  );
}

const FACTS = 6;

/** The header that tells a file's or folder's story: born when and by whom, its commits and people, its last change and Staleness, who holds it and whether they still keep the project going, and its share of fixes or its Bus Factor. */
export function Story({ story }: { story: CodeStory | undefined }) {
  if (!story) return <StorySkeleton />;
  if (story.kind === "missing") return null;
  const lead = story.holders[0];
  const days = story.last ? Math.max(0, (story.anchor - story.last.at) / DAY) : null;
  const folder = story.kind === "folder";
  const bulk = story.commits - story.counted;
  return (
    <div className="@container flex-none border-b border-line">
      <dl aria-label={folder ? "About this folder" : "About this file"} className={`m-0 grid grid-cols-2 gap-x-4 px-4 @min-[32rem]:grid-cols-3 ${folder ? "@min-[44rem]:grid-cols-4 @min-[64rem]:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]" : "@min-[56rem]:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]"}`}>
        {folder && <Fact label="Files" value={grouped(story.files)} sub={`${bytes(story.bytes)}${story.lines > 0 ? ` · ${grouped(story.lines)} lines` : ""}`} title="Files in it at HEAD, and their size" />}
        {story.born && <Fact label="Born" value={date(story.born.at)} sub={<Who p={story.born.person} />} title="The first commit that touched it" />}
        <Fact
          label="Commits"
          value={grouped(story.commits)}
          sub={`by ${many(story.people, "person", "people")}`}
          title={`Commits that touched it, merges left out${bulk > 0 ? `; ${many(bulk, "is a Bulk Commit", "are Bulk Commits")}` : ""}. People leave bots out.`}
        />
        {story.last && <Fact label="Last change" value={date(story.last.at)} sub={<Who p={story.last.person} />} title="The newest commit that touched it" />}
        {days !== null && <Fact label="Staleness" value={stalenessOf(days)} sub={many(Math.round(days), "day", "days")} title="Time from the last commit that touched it to the Build, Bulk Commits counted" />}
        {lead && (
          <Fact
            label="Held by"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Who p={lead.person} />
                <span className="text-secondary">{share(lead.commits, story.counted)}</span>
              </span>
            }
            sub={lead.maintainer ? <span className="text-brand">still a Maintainer</span> : <span>not a Maintainer now</span>}
            title={`${many(lead.commits, "commit", "commits")} of the ${grouped(story.counted)} that count, Bulk Commits left out. A Maintainer made 3 or more commits in the 90 days before the Build.`}
          />
        )}
        {folder ? (
          story.busFactor !== null && <Fact label="Bus Factor" value={grouped(story.busFactor)} sub={story.busFactor === 1 ? "one person holds 80%" : `people hold 80%`} title="The fewest people who together made more than 80% of its commits, over its whole history" />
        ) : (
          story.classified > 0 && <Fact label="Fixes" value={share(story.fixes, story.classified)} sub={`${grouped(story.fixes)} of ${many(story.classified, "commit", "commits")} with a kind`} title="Commits that touched it and read as a fix, of those whose subject says what kind of change they are; Bulk Commits left out" />
        )}
      </dl>
    </div>
  );
}

/** The story header while it loads, the same size as when it lands. */
export function StorySkeleton() {
  return (
    <div aria-hidden className="@container flex-none overflow-hidden border-b border-line">
      <div className="grid grid-cols-2 gap-x-4 px-4 @min-[32rem]:grid-cols-3 @min-[56rem]:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
        {Array.from({ length: FACTS }, (_, i) => (
          <div key={i} className="flex flex-col gap-0.5 py-2.5">
            <span className="flex h-4 items-center">
              <Skeleton height={10} width={44} radius={1} index={i} />
            </span>
            <span className="flex h-5 items-center">
              <Skeleton height={13} width={84} radius={1} index={i} />
            </span>
            <span className="flex h-4 items-center">
              <Skeleton height={10} width={68} radius={1} index={i} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
