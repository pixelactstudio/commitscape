import { Fragment, useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { Eyebrow, Page } from "@commitscape/ui";
import { AnalyticsChoice } from "#/components/Consent";
import { FEATURES, featuresAt, REGIONS, SIGNALLED, type FeatureId, type Region } from "@commitscape/data/analytics";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: `What ${PRODUCT} keeps` }] }),
  component: Privacy,
});

const PARTS = [
  ["profiles", "Profiles"],
  ["comparisons", "Comparisons, and staying out"],
  ["cards", "Cards"],
  ["repositories", "Repositories you look up"],
  ["shared", "Shared Reports"],
  ["signing-in", "Signing in with GitHub"],
  ["analytics", "Making the Site better"],
  ["command", "The command"],
  ["everyone", "Everyone"],
] as const;

function Privacy() {
  return (
    <Page className="pt-page-top pb-16">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,42rem)_14rem] lg:justify-start lg:gap-x-24">
        <article className="min-w-0 type-body text-primary text-pretty">
          <header className="flex flex-col gap-4 border-b border-separator pb-8">
            <Eyebrow className="text-brand">What we keep</Eyebrow>
            <h1 className="m-0 type-page text-balance">What {PRODUCT} keeps, and who can read it</h1>
            <p className="m-0 type-lead">
              The {PRODUCT} command reads repositories on your own machine and sends a repository nowhere unless you share it. This page is about what the Site shows about people, what it stores, what we learn from how it is used, and how to choose.
            </p>
          </header>

          <Part id="profiles" title="Profiles">
            <Item label="What">
              Anyone’s Profile at <Code>/u/login</Code> is built from what GitHub shows anyone: their name, picture, bio, followers, public pull requests, reviews and contributions, and the repositories those are in. Private work GitHub reports only as a count is counted in the totals and never named.
            </Item>
            <Item label="Your own private work">
              When you are signed in and look at your own Profile, it is read with your own GitHub sign-in, so it can name your private repositories, to you alone, marked as such. It names them for everyone only if you choose so in <Inline to="/me">Settings</Inline>.
            </Item>
            <Item label="From the repositories we have read">Your commits, the lines you changed, and the lines of yours still at a repository’s head (Surviving Lines), under every address you commit with. Email addresses are used inside the reading and never shown.</Item>
            <Item label="Where and how long">A copy of each Profile in our database, read again from GitHub when it is a day old and someone signed in looks.</Item>
            <Item label="Who can read it">Anyone signed in with GitHub. Without signing in, only its Cards open.</Item>
          </Part>

          <Part id="comparisons" title="Comparisons, and staying out">
            <Item>People are compared view by view: in each repository (Standings), and two at a time (Versus). Never with one combined score.</Item>
            <Item label="Staying out">
              Sign in and turn on “Stay out of comparisons” in <Inline to="/me">Settings</Inline>. You then appear in no one else’s Standings or Versus, and your Profile shows others only that it is hidden.
            </Item>
            <Item label="Private repositories">Their Standings are shown only to people GitHub says can see the repository, checked on every view.</Item>
          </Part>

          <Part id="cards" title="Cards">
            <Item>Cards are images of a Profile’s numbers, for READMEs and posts. They show only what the Profile shows anyone, open without signing in, are stored as images, and are refreshed at most every six hours; a hidden person has none.</Item>
          </Part>

          <Part id="repositories" title="Repositories you look up">
            <Item label="What">The repository’s Report (its numbers, file paths, the names and GitHub logins of the people who committed, and each commit’s subject line), its pull requests and reviews (who, when, how big, the title), and the facts GitHub shows anyone. Never an email address.</Item>
            <Item label="Where">The Report in Cloudflare R2, the rest in a database on our own server. The history is read on our server too, from a clone kept to make the next update quick.</Item>
            <Item label="How long">While people look at it; it is rebuilt when it is more than a day old and someone asks.</Item>
            <Item label="Each night">Our server also reads a budgeted number of the most starred public repositories, so their Reports are ready when someone looks.</Item>
          </Part>

          <Part id="shared" title="Shared Reports">
            <Item label="What">
              A Report your own machine built, locked with AES-256-GCM before it was uploaded. The key exists only in the link <Code>{`${PRODUCT} share`}</Code> printed, after the <Code>#</Code>, which browsers never send to a server. We store the locked bytes, their size, when they expire, and a hash of the Delete Token.
            </Item>
            <Item label="Where">The locked bytes in Cloudflare R2, the rest in our database.</Item>
            <Item label="How long">
              4 hours unless you chose otherwise, 12 at most; then it answers “gone” and is removed. The page’s Delete button, or <Code>{`${PRODUCT} share --delete`}</Code>, removes it at once.
            </Item>
            <Item label="Who can read it">Whoever has the link. We cannot: we never have the key. A Shared Report’s page is never recorded, and its key is never sent to PostHog.</Item>
          </Part>

          <Part id="signing-in" title="Signing in with GitHub">
            <Item label="What">
              Your GitHub account’s id, login, name, picture and email address, your sessions, the token GitHub gave the sign-in (encrypted, to read GitHub for you and ask which repositories you may see), your choices in Settings, and which repositories you chose in {PRODUCT}’s GitHub App, which can only read. For a repository you chose, its Report, as above. The short-lived tokens a Build reads a repository with are never stored.
            </Item>
            <Item label="Where">Our database and R2. A private repository’s history is cloned onto our server for its Build, and the clone and everything read from it are deleted when the Build ends; only the Report is kept, which Cloudflare encrypts at rest.</Item>
            <Item label="How long">
              A chosen repository’s Report is deleted after 30 days without a view. Removing the App from a repository on GitHub deletes its Report. "Delete my data" in <Inline to="/me">Settings</Inline> deletes your account, sessions, choices, your own copy of your Profile and those Reports at once.
            </Item>
            <Item label="Who can read it">A private repository’s Report is shown only to people GitHub says can see the repository, checked again on every view.</Item>
          </Part>

          <Part id="analytics" title="Making the Site better">
            <Item>We learn from how the Site and its landing page are used, so we can fix what is slow or confusing and build what people come back for. We do it with PostHog, through our own server, and only for that: nothing is sold, and nothing is used for advertising.</Item>
            {GROUPS.map((g) => (
              <Fragment key={g.regions.map((r) => r.id).join()}>
                <Item label={GROUPS.length > 1 ? `For everyone in ${g.regions.map((r) => r.name).join(" and ")}, without cookies` : "For everyone, without cookies"}>
                  <Features ids={g.basic} />
                </Item>
                <Item label="When you allow all">
                  <Features ids={g.more} />
                </Item>
              </Fragment>
            ))}
            <Item label="Where you are">
              {REGIONS.map((r) => `${r.name.charAt(0).toUpperCase()}${r.name.slice(1)}: ${r.before === "full" ? "all of it runs until you choose otherwise" : "only the basic counts run until you choose"}.`).join(" ")} A browser that sends Do Not Track or Global Privacy Control starts at {SIGNALLED === "basic" ? "basic" : "all"}. We tell where you are from your country, as Cloudflare reports it.
            </Item>
            <Item label="Your choice">
              The box in the corner the first time you visit, Usage data in <Inline to="/me">Settings</Inline>, or here, at any time:
              <div className="mt-3 surface px-panel py-3">
                <AnalyticsChoice />
              </div>
            </Item>
            <Item label="Never">What you type into a field, the source code and diffs on screen, the contents of any request, cookies, sign-in tokens or the key of a Shared Report.</Item>
            <Item label="Our server too">It counts moments it sees, at the same level: Builds and how long they took, Profiles and repository pages served, Cards served, Shared Reports made, opened and deleted, GitHub App installs, and runs of the command.</Item>
            <Item label="Where and how long">
              PostHog’s servers in the United States. Recordings are deleted after 30 days. If you allowed all and signed in, “Delete my data” in <Inline to="/me">Settings</Inline> also has PostHog delete everything tied to your account, recordings included.
            </Item>
          </Part>

          <Part id="command" title="The command">
            <Item>
              Each time you run <Code>{`${PRODUCT} share`}</Code>, <Code>health</Code>, <Code>surviving</Code> or <Code>report</Code>, it sends us one count: which command, how long it took, whether it worked, its version, your operating system and processor, whether it ran in CI, and a random id kept in its cache folder. Never a path, a repository, a name or an email address.
            </Item>
            <Item label="Turning it off">
              Set <Code>COMMITSCAPE_TELEMETRY=0</Code>, or <Code>DO_NOT_TRACK=1</Code>. The command says so the first time it runs.
            </Item>
            <Item label="Where">The count goes to the Site, which passes it to PostHog like a visit from where you are.</Item>
          </Part>

          <Part id="everyone" title="Everyone">
            <Item>To stop abuse, the Site counts how many lookups, Builds and Shared Reports each address starts in an hour (an IPv6 address counts with its neighbours in the same /64). It keeps a hash of the address, never the address, and deletes the count when the hour ends.</Item>
            <Item>Our server keeps logs of requests, as any host does.</Item>
            <Item>Errors in the Site are reported to Sentry, without the request’s body, headers or cookies.</Item>
          </Part>

          <p className="mt-12 mb-0 surface px-panel py-4 type-description">
            The Site’s code is open, so all of this can be checked:{" "}
            <a href="https://github.com/pixelactstudio/commitscape" className="font-medium text-primary">
              github.com/pixelactstudio/commitscape
            </a>
            .
          </p>
        </article>

        <Contents />
      </div>
    </Page>
  );
}

type Group = { regions: Region[]; basic: FeatureId[]; more: FeatureId[] };

const GROUPS: Group[] = REGIONS.reduce<Group[]>((groups, r) => {
  const basic = [...featuresAt(r, "basic")];
  const more = [...featuresAt(r, "full")].filter((f) => !basic.includes(f));
  const same = groups.find((g) => g.basic.join() === basic.join() && g.more.join() === more.join());
  if (same) same.regions.push(r);
  else groups.push({ regions: [r], basic, more });
  return groups;
}, []);

function Features({ ids }: { ids: readonly FeatureId[] }) {
  return (
    <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
      {ids.map((id) => (
        <li key={id} className="type-description">
          <span className="font-medium text-primary">{FEATURES[id].label}.</span> {FEATURES[id].says}
        </li>
      ))}
    </ul>
  );
}

function useCurrent(): string {
  const [current, setCurrent] = useState<string>(PARTS[0][0]);
  useEffect(() => {
    const seen = new Map<string, boolean>();
    const watch = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = PARTS.find(([id]) => seen.get(id));
        if (first) setCurrent(first[0]);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    for (const [id] of PARTS) {
      const el = document.getElementById(id);
      if (el) watch.observe(el);
    }
    return () => watch.disconnect();
  }, []);
  return current;
}

function Contents() {
  const current = useCurrent();
  return (
    <nav aria-label="On this page" className="hidden lg:block">
      <div className="sticky top-[calc(var(--chrome-top)+1.5rem)] flex flex-col gap-0.5 border-s border-separator">
        <span className="type-eyebrow ps-4 pb-2">On this page</span>
        {PARTS.map(([id, label]) => (
          <a key={id} href={`#${id}`} aria-current={current === id ? "location" : undefined} className={`-ms-px border-s py-1 ps-4 type-description no-underline transition-colors duration-(--duration-instant) hover:text-primary ${current === id ? "border-brand font-medium text-primary" : "border-transparent"}`}>
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-(--chrome-top) pt-10">
      <h2 id={`${id}-title`} className="m-0 pb-3 type-heading">
        {title}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">{children}</ul>
    </section>
  );
}

function Item({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <li className="relative ps-5 text-primary before:absolute before:start-0 before:top-[0.8em] before:size-1.5 before:rounded-full before:bg-line-strong before:content-['']">
      {label && <strong className="font-semibold text-primary">{label}: </strong>}
      {children}
    </li>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono">{children}</code>;
}

function Inline({ to, children }: { to: "/me"; children: ReactNode }) {
  return (
    <Link to={to} className="font-medium text-primary underline decoration-line underline-offset-4 hover:decoration-current">
      {children}
    </Link>
  );
}
