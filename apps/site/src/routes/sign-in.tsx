import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Eye, Gauge, Image as ImageIcon, LogIn, type LucideIcon } from "lucide-react";
import { PRODUCT } from "@commitscape/data";
import { Logo, Page } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { HOME, returnTo } from "#/lib/access";
import { signIn } from "#/lib/auth-client";
import { track } from "#/lib/analytics";

type Search = { next?: string; error?: string };

const text = (value: unknown, max: number) => (typeof value === "string" && value.length <= max ? value : undefined);

export const Route = createFileRoute("/sign-in")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const next = text(s.next, 2000);
    const error = text(s.error, 80);
    return { ...(next ? { next } : {}), ...(error ? { error } : {}) };
  },
  beforeLoad: ({ context, search }) => {
    if (context.user) throw redirect({ href: returnTo(search.next) });
  },
  head: () => ({ meta: [{ title: `Sign in · ${PRODUCT}` }, { name: "robots", content: "noindex" }] }),
  component: SignIn,
});

const FACTS: [LucideIcon, string, string][] = [
  [Eye, "It only reads", "commitscape never changes anything on GitHub."],
  [Gauge, "Your own GitHub allowance", "It reads GitHub for you with your own allowance, so nobody else’s use slows yours down."],
  [ImageIcon, "Cards stay open", "Cards in READMEs, Shared Reports and shared Proof of Work open for anyone, signed in or not."],
];

function problemOf(code: string): { title: string; words: string } {
  if (code === "access_denied") return { title: "You cancelled signing in on GitHub", words: "Sign in again when you are ready." };
  if (code === "PROVIDER_NOT_FOUND") return { title: "This Site cannot sign anyone in yet", words: "Signing in with GitHub is not set up here. Ask whoever runs it to add a GitHub App." };
  if (code === "unreachable") return { title: "Signing in could not start", words: "The Site did not answer. Check your connection and try again." };
  return { title: "GitHub did not sign you in", words: "Try again. If it keeps failing, check that commitscape is allowed in your GitHub settings, under Applications." };
}

function SignIn() {
  const search = Route.useSearch();
  const { public: settings } = Route.useRouteContext();
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const next = returnTo(search.next);
  const problem = failed ?? search.error ?? null;
  const landing = settings?.PUBLIC_LANDING_URL;
  const start = async () => {
    setStarting(true);
    setFailed(null);
    track("sign in started", { next });
    const code = await signIn(next);
    if (code) {
      track("sign in failed", { code });
      setFailed(code);
      setStarting(false);
    }
  };
  return (
    <Page className="pt-page-top pb-section">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-8 pt-section">
        <div className="flex flex-col items-start gap-5">
          <Logo size={44} />
          <div className="flex flex-col gap-3">
            <span className="type-eyebrow text-brand">Sign in</span>
            <h1 tabIndex={-1} className="m-0 type-page outline-offset-4">
              Sign in to {PRODUCT}
            </h1>
            <p className="m-0 type-lead text-pretty">
              {next === HOME ? "See what you have built on GitHub, where you stand among the people you build with, and Cards to share it." : "Sign in with GitHub to open the page you asked for. You come straight back to it."}
            </p>
          </div>
        </div>
        {problem && <Banner status="error" title={problemOf(problem).title} description={problemOf(problem).words} />}
        <div className="flex flex-col items-start gap-3">
          <Button label="Sign in with GitHub" variant="primary" size="lg" icon={<Icon icon={LogIn} size="sm" />} isLoading={starting} onClick={() => void start()} />
        </div>
        <ul aria-label="What signing in means" className="m-0 flex list-none flex-col divide-y divide-line surface p-0">
          {FACTS.map(([Glyph, title, words]) => (
            <li key={title} className="flex gap-3 px-panel py-4">
              <span className="grid size-8 flex-none place-items-center rounded-md bg-brand-soft text-brand">
                <Glyph size={ICON.md} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="type-label">{title}</span>
                <span className="type-description text-pretty">{words}</span>
              </span>
            </li>
          ))}
        </ul>
        <nav aria-label="More about commitscape" className="flex flex-wrap items-center gap-x-5 gap-y-2 type-caption">
          <Link to="/privacy" className="inline-link">
            What we keep
          </Link>
          {landing && (
            <a href={landing} className="inline-link">
              About {PRODUCT}
            </a>
          )}
        </nav>
      </div>
    </Page>
  );
}
