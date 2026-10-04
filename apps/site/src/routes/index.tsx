import { useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import { ArrowRight, Briefcase, Check, Copy, Image as ImageIcon, LayoutDashboard, Sparkles, Swords, Trophy, Users } from "lucide-react";
import { PRODUCT } from "@commitscape/data";
import { Face, Page } from "@commitscape/ui";
import { signIn } from "#/lib/auth-client";
import { Lookup } from "#/components/Lookup";
import { ThemedCard } from "#/components/ThemedCard";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: `${PRODUCT}: what you have built, in numbers worth sharing` }] }),
  component: Landing,
});

const EXAMPLES: [string, string][] = [
  ["gaearon", "React, then Bluesky"],
  ["BurntSushi", "ripgrep"],
  ["sindresorhus", "a thousand packages"],
  ["torvalds", "Linux and git"],
];

const YEAR = new Date().getUTCFullYear();

function Landing() {
  const { user } = useRouteContext({ from: "__root__" });
  return (
    <>
      <section className="hero-backdrop relative overflow-hidden border-b border-line">
        <Page className="relative grid items-center gap-12 pt-14 pb-16 lg:grid-cols-[1.08fr_1fr] lg:pt-20 lg:pb-24">
          <div className="flex min-w-0 flex-col gap-7">
            <span className="rise inline-flex w-fit items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[0.8rem] text-secondary backdrop-blur">
              <span className="size-1.5 rounded-full bg-brand" />
              Open source. Reads GitHub and git history; never guesses.
            </span>
            <h1 className="rise m-0 text-[clamp(2.5rem,6.2vw,4.5rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance [animation-delay:40ms]">
              What you've built, <span className="brand-text">in numbers worth sharing.</span>
            </h1>
            <p className="rise m-0 max-w-xl text-[1.12rem] leading-relaxed text-pretty text-secondary [animation-delay:80ms]">
              Your pull requests, reviews and the lines of yours that still run. Where you stand in every repository you work on. And Cards for your README, LinkedIn and X.
            </p>
            <div className="rise max-w-xl [animation-delay:120ms]">
              <Lookup autoFocus />
            </div>
            <div className="rise flex flex-wrap items-center gap-2 [animation-delay:160ms]">
              <span className="me-1 text-sm text-secondary">Try</span>
              {EXAMPLES.map(([login, words]) => (
                <Link key={login} to="/u/$login" params={{ login }} className="group flex items-center gap-2 rounded-full border border-line bg-surface py-1 ps-1 pe-3 text-sm text-primary no-underline transition-colors hover:border-strong" title={words}>
                  <Face login={login} name={login} size={24} />
                  <span className="font-medium">{login}</span>
                </Link>
              ))}
            </div>
            <div className="rise text-sm text-secondary [animation-delay:200ms]">
              {user ? (
                <Link to="/u/$login" params={{ login: user.login }} className="inline-flex items-center gap-1 font-medium text-primary no-underline hover:underline">
                  Open your Profile, @{user.login} <ArrowRight size={14} />
                </Link>
              ) : (
                <>
                  Or{" "}
                  <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-medium text-primary underline-offset-4 hover:underline" onClick={() => signIn("/you")}>
                    sign in with GitHub
                  </button>{" "}
                  to see your private work counted too. Read-only, and you can hide.
                </>
              )}
            </div>
          </div>
          <CardFan />
        </Page>
      </section>

      <Page className="flex flex-col gap-24 py-20">
        <section className="flex flex-col gap-10">
          <Intro eyebrow="One link" title="Everything you've built, on one page" words="Every number says what it counts, comes from GitHub or the repository's own history, and is never folded into one score." />
          <div className="grid gap-4 md:grid-cols-3">
            <Feature className="md:col-span-2" icon={LayoutDashboard} title="Your Profile" words="Pull requests merged, reviews given, lines that still run, streaks, languages over the years and the people you work with most." to="/u/gaearon" cta="See gaearon's">
              <ProfileArt />
            </Feature>
            <Feature icon={Trophy} title="Where you stand" words="In each repository you work on, your place among everyone in it, view by view." to="/gh/facebook/react" cta="Open facebook/react">
              <StandingArt />
            </Feature>
            <Feature icon={Swords} title="Versus" words="You and anyone, side by side. A winner for each view, never one overall." to="/vs/gaearon/acdlite" cta="gaearon versus acdlite">
              <VersusArt />
            </Feature>
            <Feature className="md:col-span-2" icon={ImageIcon} title="Cards you can make your own" words="For your README, a post or a self-review. Pick a preset or your own colours and background; light and dark, animated where GitHub allows it." to="/u/gaearon/cards" cta="Open the Card studio">
              <CardsArt />
            </Feature>
            <Feature icon={Sparkles} title={`Wrapped ${YEAR}`} words="Your year on GitHub, told as a page and a Card." to={`/u/gaearon/wrapped/${YEAR}`} cta="See one">
              <WrappedArt />
            </Feature>
            <Feature icon={Briefcase} title="Proof of Work" words="Every merged pull request and commit for a period, by month and repository, as a link, Markdown or a PDF." to="/u/gaearon/work" cta="See one">
              <WorkArt />
            </Feature>
            <Feature icon={Users} title="Races and Crews" words="Race friends over a week, or keep a Crew that compares itself each month." to="/races" cta="Start one">
              <RaceArt />
            </Feature>
          </div>
        </section>

        <section className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
          <Intro eyebrow="Or keep it on your machine" title="The same numbers, from your terminal" words="Run it in any git repository. Nothing leaves your machine, and a link shares a Report from a server without holding the terminal open." />
          <Terminal />
        </section>

        <section className="cta-backdrop relative overflow-hidden rounded-[28px] border border-line px-6 py-14 text-center sm:px-12">
          <div className="relative mx-auto flex max-w-xl flex-col items-center gap-6">
            <h2 className="m-0 text-[clamp(1.8rem,4vw,2.6rem)] leading-tight font-semibold tracking-[-0.035em]">Your turn.</h2>
            <p className="m-0 text-secondary">Type your GitHub username. Your Profile is read from GitHub at once.</p>
            <div className="w-full text-start">
              <Lookup label="Show me mine" />
            </div>
          </div>
        </section>
      </Page>
    </>
  );
}

function Intro({ eyebrow, title, words }: { eyebrow: string; title: string; words: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <span className="text-sm font-medium text-brand">{eyebrow}</span>
      <h2 className="m-0 text-[clamp(1.7rem,3.4vw,2.4rem)] leading-[1.1] font-semibold tracking-[-0.035em] text-balance">{title}</h2>
      <p className="m-0 text-[1.02rem] text-pretty text-secondary">{words}</p>
    </div>
  );
}

function Feature({ icon, title, words, to, cta, children, className = "" }: { icon: typeof Trophy; title: string; words: string; to: string; cta: string; children: ReactNode; className?: string }) {
  const Glyph = icon;
  return (
    <Link to={to as "/"} className={`feature group flex flex-col overflow-hidden rounded-[var(--radius-container)] border border-line bg-surface text-primary no-underline transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-strong ${className}`}>
      <div className="relative h-44 overflow-hidden border-b border-line bg-[var(--color-background-body)]" aria-hidden>
        {children}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <span className="flex items-center gap-2 font-semibold">
          <Glyph size={16} className="text-brand" />
          {title}
        </span>
        <span className="text-sm text-pretty text-secondary">{words}</span>
        <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-medium">
          {cta}
          <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

function wave(n: number, seed: number) {
  return Array.from({ length: n }, (_, i) => {
    const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
  });
}

function ProfileArt() {
  const cells = wave(26 * 7, 3);
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-5 px-6">
      <div className="flex gap-6">
        {["pull requests merged", "reviews given", "lines still running"].map((l, i) => (
          <div key={l} className="flex flex-col gap-1.5">
            <span className={`h-5 rounded ${i === 2 ? "w-16 bg-brand" : "w-20 bg-[var(--color-text-primary)] opacity-80"}`} />
            <span className="text-[0.7rem] text-secondary">{l}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridAutoColumns: "10px" }}>
        {cells.map((v, i) => (
          <span key={i} className="size-[10px] rounded-[3px]" style={{ background: v > 0.62 ? `var(--green-${Math.min(4, 1 + Math.floor((v - 0.62) * 10))})` : "var(--empty)" }} />
        ))}
      </div>
    </div>
  );
}

function StandingArt() {
  const rows = [0.92, 0.74, 0.61, 0.43, 0.3];
  return (
    <ol className="absolute inset-0 m-0 flex list-none flex-col justify-center gap-2 px-6">
      {rows.map((w, i) => (
        <li key={w} className={`flex items-center gap-2.5 rounded-md px-2 py-1 ${i === 2 ? "bg-brand-soft ring-1 ring-[var(--brand)]" : ""}`}>
          <span className="w-4 text-[0.7rem] text-secondary tnum">{i + 1}</span>
          <span className={`size-4 rounded-full ${i === 2 ? "bg-brand" : "bg-[var(--color-track)]"}`} />
          <span className="h-1.5 rounded-full bg-[var(--color-text-secondary)] opacity-60" style={{ width: `${w * 60}%` }} />
          {i === 2 && <span className="ms-auto text-[0.7rem] font-semibold text-primary">you</span>}
        </li>
      ))}
    </ol>
  );
}

function VersusArt() {
  const rows = [
    [0.8, 0.55],
    [0.4, 0.9],
    [0.7, 0.62],
    [0.3, 0.45],
  ];
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-3 px-6">
      <div className="flex items-center justify-between text-[0.7rem] font-semibold text-secondary">
        <span>you</span>
        <span>vs</span>
        <span>them</span>
      </div>
      {rows.map(([a = 0, b = 0], i) => (
        <div key={i} className="grid grid-cols-2 gap-1.5">
          <span className="flex justify-end">
            <span className={`h-2 rounded-s-full ${a > b ? "bg-brand" : "bg-[var(--color-track)]"}`} style={{ width: `${a * 100}%` }} />
          </span>
          <span className={`h-2 rounded-e-full ${b > a ? "bg-[var(--s1)]" : "bg-[var(--color-track)]"}`} style={{ width: `${b * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

const PRESET_ART = [
  ["#0c0d0f", "#3ccf74"],
  ["linear-gradient(135deg,#1e1b4b,#4c1d95)", "#c4b5fd"],
  ["linear-gradient(135deg,#fff7ed,#fde68a)", "#ea580c"],
  ["linear-gradient(135deg,#042f2e,#0e7490)", "#5eead4"],
  ["#ffffff", "#2a78d6"],
];

function CardsArt() {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-3 px-6">
      {PRESET_ART.map(([bg, accent], i) => (
        <span
          key={i}
          className="flex h-28 w-36 flex-none flex-col justify-between rounded-xl border border-line p-3 shadow-[var(--shadow-med)] transition-transform duration-300 group-hover:-translate-y-1"
          style={{ background: bg, transform: `rotate(${(i - 2) * 3}deg)`, transitionDelay: `${i * 30}ms` }}
        >
          <span className="h-2 w-14 rounded-full opacity-70" style={{ background: accent }} />
          <span className="flex items-end gap-1">
            {[0.4, 0.7, 0.55, 0.9, 0.65].map((h, j) => (
              <span key={j} className="w-3 rounded-t-sm" style={{ height: `${h * 38}px`, background: accent, opacity: 0.35 + j * 0.13 }} />
            ))}
          </span>
        </span>
      ))}
    </div>
  );
}

function WrappedArt() {
  return (
    <div className="wrapped-art absolute inset-0 flex items-center justify-center">
      <span className="text-[4.5rem] leading-none font-bold tracking-[-0.06em] text-white/95">{YEAR}</span>
    </div>
  );
}

function WorkArt() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-2.5 px-6">
      {[0.8, 0.62, 0.7, 0.48].map((w, i) => (
        <div key={w} className="flex items-center gap-2.5">
          <span className={`flex size-4 items-center justify-center rounded-full ${i < 3 ? "bg-brand" : "bg-[var(--color-track)]"}`}>{i < 3 && <Check size={10} className="text-white" strokeWidth={3} />}</span>
          <span className="h-1.5 rounded-full bg-[var(--color-text-secondary)] opacity-60" style={{ width: `${w * 70}%` }} />
          <span className="ms-auto text-[0.65rem] text-added tnum">+{Math.round(w * 400)}</span>
        </div>
      ))}
    </div>
  );
}

function RaceArt() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-3 px-6">
      {[0.86, 0.7, 0.52].map((w, i) => (
        <div key={w} className="flex items-center gap-2">
          <span className="size-5 flex-none rounded-full bg-[var(--color-track)]" />
          <span className="relative h-2 flex-1 rounded-full bg-[var(--color-track)]">
            <span className={`absolute inset-y-0 start-0 rounded-full ${i === 0 ? "bg-brand" : "bg-[var(--color-text-secondary)] opacity-60"}`} style={{ width: `${w * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function CardFan() {
  return (
    <div className="card-fan relative mx-auto hidden aspect-[1.02] w-full max-w-[34rem] lg:block" aria-label="Cards made for gaearon">
      <div className="card-fan-item absolute top-[4%] right-0 w-[86%] rotate-[5deg]">
        <ThemedCard src="/api/cards/u/gaearon/repositories" alt="gaearon's top repositories" width={600} height={400} eager />
      </div>
      <div className="card-fan-item absolute top-[38%] left-0 w-[92%] -rotate-[3deg]">
        <ThemedCard src="/api/cards/u/gaearon/calendar" alt="gaearon's last year" width={855} height={236} eager />
      </div>
      <div className="card-fan-item absolute bottom-[2%] right-[4%] w-[78%] rotate-[1.5deg]">
        <ThemedCard src="/api/cards/u/gaearon/totals" alt="gaearon's totals" width={600} height={236} eager />
      </div>
    </div>
  );
}

const INSTALL: Record<string, { label: string; command: string; note: string }> = {
  npm: { label: "npm", command: "npx commitscape", note: "Or npm install -g commitscape." },
  brew: { label: "Homebrew", command: "brew install pixelactstudio/commitscape/commitscape", note: "Then run commitscape in any repository." },
  nix: { label: "Nix", command: "nix run github:pixelactstudio/commitscape", note: "No install; Nix builds and runs it." },
  share: { label: "Share", command: "npx commitscape share", note: "Prints a link only its holder can open. It expires within hours." },
};

function Terminal() {
  const [tab, setTab] = useState("npm");
  const [copied, setCopied] = useState(false);
  const pick = INSTALL[tab] ?? INSTALL.npm;
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl label="How to install" value={tab} onChange={(v) => { setTab(v); setCopied(false); }} size="sm">
        {Object.entries(INSTALL).map(([k, v]) => (
          <SegmentedControlItem key={k} value={k} label={v.label} />
        ))}
      </SegmentedControl>
      <div className="overflow-hidden rounded-[var(--radius-container)] border border-line bg-[#0b0c0e] text-[#e7e7ea] shadow-[var(--shadow-high)]">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} className="size-2.5 rounded-full" style={{ background: c }} />
          ))}
          <span className="ms-3 text-xs text-white/50">~/code/my-project</span>
        </div>
        <div className="flex items-center gap-3 px-5 py-5 font-mono text-[0.92rem]">
          <span className="text-[#3ccf74]">$</span>
          <span className="min-w-0 flex-1 truncate">{pick?.command}</span>
          <Button
            label={copied ? "Copied" : "Copy"}
            isIconOnly
            size="sm"
            variant="ghost"
            icon={<Icon icon={copied ? Check : Copy} size="sm" />}
            onClick={() => void navigator.clipboard?.writeText(pick?.command ?? "").then(() => setCopied(true))}
          />
        </div>
      </div>
      <p className="m-0 text-sm text-secondary">{pick?.note}</p>
    </div>
  );
}
