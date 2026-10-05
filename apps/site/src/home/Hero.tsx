import { Link, useRouteContext } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Face } from "@commitscape/ui";
import { signIn } from "#/lib/auth-client";
import { Lookup } from "#/components/Lookup";
import { HeroCards } from "./scenes/HeroCards";

const EXAMPLES: [string, string][] = [
  ["gaearon", "React, then Bluesky"],
  ["BurntSushi", "ripgrep"],
  ["sindresorhus", "a thousand packages"],
  ["torvalds", "Linux and git"],
];

const SOURCE = "https://github.com/pixelactstudio/commitscape";

/** The top of the home page: what commitscape is, the lookup, and real Cards. Drawn visible on the server. */
export function Hero() {
  const { user } = useRouteContext({ from: "__root__" });
  return (
    <section className="hero relative overflow-hidden">
      <div className="relative grid items-center gap-14 px-5 pt-14 pb-16 sm:px-10 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pt-24 lg:pb-20">
        <div className="flex min-w-0 flex-col gap-7">
          <a href={SOURCE} className="rise group inline-flex w-fit items-center gap-2 rounded-full border border-line bg-[var(--color-background-surface)] py-1 ps-1 pe-3 text-[0.8rem] text-secondary no-underline transition-colors hover:border-[var(--color-border-emphasized)] hover:text-primary">
            <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand">Open source</span>
            <span className="sm:hidden">Reads GitHub; never guesses</span>
            <span className="max-sm:hidden">Reads GitHub and git history; never guesses</span>
            <ArrowUpRight size={13} className="transition-transform group-hover:translate-x-px group-hover:-translate-y-px" aria-hidden />
          </a>
          <h1 className="rise m-0 text-[clamp(2.7rem,6vw,4.75rem)] leading-[0.98] font-semibold tracking-[-0.055em] text-balance [animation-delay:50ms]">
            What you've built, <span className="hero-quiet">in numbers worth sharing.</span>
          </h1>
          <p className="rise m-0 max-w-[34rem] text-[1.1rem] leading-relaxed text-pretty text-secondary [animation-delay:100ms]">
            Your pull requests, reviews and the lines of yours that still run. Where you stand in every repository you work on. And Cards for your README, LinkedIn and X.
          </p>
          <div className="rise max-w-[34rem] [animation-delay:150ms]">
            <Lookup autoFocus />
          </div>
          <div className="rise flex flex-wrap items-center gap-2 [animation-delay:200ms]">
            <span className="me-1 text-sm text-secondary">Try</span>
            {EXAMPLES.map(([login, words]) => (
              <Link key={login} to="/u/$login" params={{ login }} className="flex items-center gap-2 rounded-full border border-line bg-[var(--color-background-surface)] py-1 ps-1 pe-3 text-sm text-primary no-underline transition-colors hover:border-[var(--color-border-emphasized)]" title={words}>
                <Face login={login} name={login} size={24} />
                <span className="font-medium">{login}</span>
              </Link>
            ))}
          </div>
          <div className="rise text-sm text-secondary [animation-delay:250ms]">
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
        <HeroCards />
      </div>
    </section>
  );
}
