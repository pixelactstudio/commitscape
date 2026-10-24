import { Link, useRouteContext } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Face } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { signIn } from "#/lib/auth-client";
import { Lookup } from "#/components/Lookup";
import { HeroCards } from "./scenes/HeroCards";

const EXAMPLES: [string, string][] = [
  ["gaearon", "React, then Bluesky"],
  ["BurntSushi", "ripgrep"],
  ["sindresorhus", "a thousand packages"],
  ["torvalds", "Linux and git"],
];

const REPOS = ["BurntSushi/ripgrep", "react/react"];

const SOURCE = "https://github.com/pixelactstudio/commitscape";

/** The top of the home page: what commitscape is, the lookup, and real Cards. Drawn visible on the server. */
export function Hero() {
  const { user } = useRouteContext({ from: "__root__" });
  return (
    <section className="hero relative overflow-hidden">
      <div className="relative grid items-center gap-16 px-(--gutter) pt-page-top pb-16 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:py-band">
        <div className="flex min-w-0 flex-col gap-6">
          <a href={SOURCE} className="rise group inline-flex w-fit items-center gap-2 rounded-full border border-line bg-surface py-1 ps-1 pe-3 type-caption no-underline transition-colors hover:border-line-strong hover:text-primary">
            <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand">Open source</span>
            <span className="sm:hidden">Reads GitHub; never guesses</span>
            <span className="max-sm:hidden">Reads GitHub and git history; never guesses</span>
            <ArrowUpRight size={ICON.xs} className="transition-transform group-hover:translate-x-px group-hover:-translate-y-px" aria-hidden />
          </a>
          <h1 className="rise m-0 type-hero [animation-delay:50ms]">
            What you’ve built, <span className="hero-quiet">in numbers worth sharing.</span>
          </h1>
          <p className="rise m-0 max-w-136 type-lead [animation-delay:100ms]">
            Your pull requests, reviews and the lines of yours that still run. Where you stand in every repository you work on. And Cards for your README, LinkedIn and X.
          </p>
          <div className="rise max-w-136 [animation-delay:150ms]">
            <Lookup autoFocus />
          </div>
          <div className="rise grid grid-cols-1 items-center gap-x-3 gap-y-2 sm:grid-cols-[auto_1fr] [animation-delay:200ms]">
            <span className="type-caption">Try a person</span>
            <div className="flex flex-wrap items-center gap-2">
              {EXAMPLES.map(([login, words]) => (
                <Link key={login} to="/u/$login" params={{ login }} className="surface row-hover flex items-center gap-2 rounded-full! py-1 ps-1 pe-3 type-caption font-medium text-primary no-underline" title={words}>
                  <Face login={login} name={login} size={24} decorative />
                  {login}
                </Link>
              ))}
            </div>
            <span className="type-caption">or a repository</span>
            <div className="flex flex-wrap items-center gap-2">
              {REPOS.map((r) => {
                const [owner = "", name = ""] = r.split("/");
                return (
                  <Link key={r} to="/gh/$owner/$repo" params={{ owner, repo: name }} className="surface row-hover flex items-center gap-2 rounded-full! py-1 ps-1 pe-3 type-caption font-medium text-primary no-underline">
                    <Face login={owner} name={owner} size={24} shape="rounded" decorative />
                    {r}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="rise type-caption [animation-delay:250ms]">
            {user ? (
              user.login && (
                <Link to="/u/$login" params={{ login: user.login }} className="inline-flex items-center gap-1 font-medium text-primary no-underline hover:underline">
                  Open your Profile, @{user.login} <ArrowRight size={ICON.sm} />
                </Link>
              )
            ) : (
              <>
                Or{" "}
                <button type="button" className="plain-button font-medium text-primary underline-offset-4 hover:underline" onClick={() => signIn("/you")}>
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
