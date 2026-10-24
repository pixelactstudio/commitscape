import { Link } from "@tanstack/react-router";
import { ArrowRight, Boxes, Code2, GitBranch, GitPullRequest, Layers3, Users, type LucideIcon } from "lucide-react";
import { Face } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { Reveal, STAGGER } from "@commitscape/ui/motion";
import { Band, Kicker } from "./layout";
import { ReportScene } from "./scenes/ReportScene";

const PARTS: { icon: LucideIcon; title: string; words: string }[] = [
  { icon: Users, title: "People", words: "Who holds each file and how much of it still runs, and who is still around to ask." },
  { icon: Layers3, title: "Universe", words: "Every file the repository ever had as one map, replayed from its first commit." },
  { icon: Code2, title: "Code", words: "Open any file with its story: when it was born, who changed it, how often it was a fix." },
  { icon: GitBranch, title: "Branches", words: "What is in flight, what is stuck, what is safe to delete, and how releases flow." },
  { icon: GitPullRequest, title: "Pull requests", words: "How long they take to merge, who reviews, and what sat open for months." },
];

const REPOS = ["BurntSushi/ripgrep", "react/react", "freeCodeCamp/freeCodeCamp"];

/** The repository side of the product: what a Report holds, a small scene of it, and real repositories to open. */
export function Reports() {
  return (
    <Band label="Repositories">
      <div className="grid items-center gap-12 px-(--gutter) py-20 sm:py-band lg:grid-cols-[1fr_1.1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <Reveal blur={false} y={0}>
            <Kicker icon={Boxes}>Any repository</Kicker>
          </Reveal>
          <Reveal as="h2" delay={STAGGER.base} className="m-0 type-display">
            A repository’s whole history, read once
          </Reveal>
          <Reveal as="p" delay={STAGGER.loose} className="m-0 max-w-lg type-lead">
            commitscape reads every commit, who made it and the lines each one changed, then shows what that says: not a log, a Report.
          </Reveal>
          <Reveal delay={STAGGER.loose}>
            <ul className="m-0 flex max-w-lg list-none flex-col gap-4 p-0">
              {PARTS.map((p) => (
                <li key={p.title} className="flex gap-3">
                  <span className="grid size-8 flex-none place-items-center rounded-md bg-brand-soft text-brand">
                    <p.icon size={ICON.md} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="type-label">{p.title}</span>
                    <span className="type-description">{p.words}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={STAGGER.loose} className="flex flex-wrap items-center gap-2">
            <span className="me-1 type-caption">Open one</span>
            {REPOS.map((r) => {
              const [owner = "", name = ""] = r.split("/");
              return (
                <Link key={r} to="/gh/$owner/$repo" params={{ owner, repo: name }} className="group surface row-hover flex items-center gap-2 rounded-full! py-1 ps-1 pe-3 type-caption font-medium text-primary no-underline">
                  <Face login={owner} name={owner} size={24} decorative />
                  {r}
                  <ArrowRight size={ICON.xs} className="text-tertiary transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              );
            })}
          </Reveal>
        </div>
        <div aria-hidden className="h-104 min-w-0">
          <ReportScene />
        </div>
      </div>
    </Band>
  );
}
