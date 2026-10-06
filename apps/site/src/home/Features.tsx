import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ICON } from "@commitscape/ui/design";
import { ArrowRight, Briefcase, Image as ImageIcon, LayoutDashboard, Layers, Sparkles, Swords, Trophy, Users, type LucideIcon } from "lucide-react";
import { Band, Heading } from "./layout";
import { CardsScene } from "./scenes/CardsScene";
import { YEAR } from "./scenes/data";
import { ProfileScene } from "./scenes/ProfileScene";
import { RaceScene } from "./scenes/RaceScene";
import { StandingScene } from "./scenes/StandingScene";
import { VersusScene } from "./scenes/VersusScene";
import { WorkScene } from "./scenes/WorkScene";
import { WrappedScene } from "./scenes/WrappedScene";

type Tile = { icon: LucideIcon; title: string; words: string; to: string; cta: string; scene: ReactNode; wide?: boolean; bleed?: boolean };

const TILES: Tile[] = [
  { icon: LayoutDashboard, title: "Your Profile", words: "Pull requests merged, reviews given, lines that still run, streaks, languages over the years and the people you work with most.", to: "/u/gaearon", cta: "See gaearon's", scene: <ProfileScene />, wide: true },
  { icon: Trophy, title: "Where you stand", words: "In each repository you work on, your place among everyone in it, view by view.", to: "/u/gaearon/react/react", cta: "See gaearon in react/react", scene: <StandingScene /> },
  { icon: Swords, title: "Versus", words: "You and anyone, side by side. A winner for each view, never one overall.", to: "/vs/gaearon/acdlite", cta: "gaearon versus acdlite", scene: <VersusScene /> },
  { icon: ImageIcon, title: "Cards you can make your own", words: "For your README, a post or a self-review. Pick a preset or your own colours and background; light and dark, animated where GitHub allows it.", to: "/u/gaearon/cards", cta: "Open the Card studio", scene: <CardsScene />, wide: true },
  { icon: Sparkles, title: `Wrapped ${YEAR}`, words: "Your year on GitHub, told as a page and a Card.", to: `/u/gaearon/wrapped/${YEAR}`, cta: "See one", scene: <WrappedScene />, bleed: true },
  { icon: Briefcase, title: "Proof of Work", words: "Every merged pull request and commit for a period, by month and repository, as a link, Markdown or a PDF.", to: "/u/gaearon/work", cta: "See one", scene: <WorkScene /> },
  { icon: Users, title: "Races and Crews", words: "Race friends over a week, or keep a Crew that compares itself each month.", to: "/races", cta: "Start one", scene: <RaceScene /> },
];

/** The bento of everything commitscape makes, each tile a small live scene that links to a real example. */
export function Features() {
  return (
    <Band label="What it makes" className="pt-16 sm:pt-band">
      <Heading icon={Layers} eyebrow="One link" title="Everything you've built, on one page" words="Every number says what it counts, comes from GitHub or the repository's own history, and is never folded into one score." />
      <div className="tiles mt-section grid grid-cols-1 gap-px border-t border-line bg-line sm:mt-16 md:grid-cols-3">
        {TILES.map((t) => (
          <FeatureTile key={t.title} {...t} />
        ))}
      </div>
    </Band>
  );
}

function FeatureTile({ icon: Glyph, title, words, to, cta, scene, wide, bleed }: Tile) {
  return (
    <Link to={to as "/"} className={`tile group relative flex min-w-0 flex-col bg-body text-primary no-underline outline-offset-[-2px] ${wide ? "md:col-span-2" : ""}`}>
      <div aria-hidden className={`relative h-72 overflow-hidden ${bleed ? "" : "scene-stage px-6 py-6 sm:px-8"}`}>
        {scene}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-6 pt-5 pb-7 sm:px-8">
        <span className="flex items-center gap-2 type-panel">
          <Glyph size={ICON.md} className="flex-none text-brand" aria-hidden />
          {title}
        </span>
        <span className="max-w-[34rem] type-description">{words}</span>
        <span className="mt-auto inline-flex items-center gap-1 pt-4 type-label">
          {cta}
          <ArrowRight size={ICON.sm} className="transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
