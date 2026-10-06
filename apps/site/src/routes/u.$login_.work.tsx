import { Component, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Copy, Download, Link2, Lock, LogIn, Share2 } from "lucide-react";
import { groupWork, inFilter, isWorkGate, periodDates, periodWords, PRODUCT, WORK_KINDS, type Work, type WorkGate, type WorkKind } from "@commitscape/data";
import { Face, grouped, many, Page, PageHead, Panel, PeriodPicker, RepoPicker, WorkSkeleton, WorkView, type WorkLook } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { Missing } from "#/components/Missing";
import { shareMyWork } from "#/functions/work";
import { signIn } from "#/lib/auth-client";
import { profileLookupQuery, workQuery } from "#/lib/queries";
import { useToast } from "#/lib/toast";

type Search = { from: string; to: string; filter?: string; group?: "repository"; kind?: WorkKind };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/u/$login_/work")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const last = periodDates("last-year");
    const from = typeof s.from === "string" && DATE.test(s.from) ? s.from : last.from;
    const to = typeof s.to === "string" && DATE.test(s.to) ? s.to : last.to;
    return {
      from,
      to,
      ...(typeof s.filter === "string" && s.filter ? { filter: s.filter } : {}),
      ...(s.group === "repository" ? { group: "repository" as const } : {}),
      ...(WORK_KINDS.some((k) => k.kind === s.kind) ? { kind: s.kind as WorkKind } : {}),
    };
  },
  loader: async ({ params, context }) => ({ lookup: await context.queryClient.ensureQueryData(profileLookupQuery(params.login)), origin: context.origin ?? "" }),
  head: ({ params }) => ({ meta: [{ title: `@${params.login}'s Proof of Work on ${PRODUCT}` }, { name: "robots", content: "noindex" }] }),
  component: ProofOfWork,
});

const queryOf = (search: Search) => new URLSearchParams({ from: search.from, to: search.to, ...(search.filter ? { filter: search.filter } : {}) }).toString();

function ProofOfWork() {
  const { login } = Route.useParams();
  const search = Route.useSearch();
  const { data: lookup } = useSuspenseQuery(profileLookupQuery(login));
  if (lookup.status === "hidden") return <Missing title="This Proof of Work is hidden" words="This person has chosen to stay out, so their Proof of Work shows nothing." />;
  if (lookup.status !== "ok") return <Missing title={`No one called @${login}`} words="GitHub has no person by that name. Check its spelling, or search for them." />;
  const id = lookup.identity;
  const name = id.name ?? id.login;
  return <Proof login={id.login} name={name} self={lookup.self} search={search} />;
}

function useGate(login: string, search: Search): WorkGate | null {
  const base = useQuery(workQuery(login, search.from, search.to, null)).data;
  const gated = !!base && isWorkGate(base);
  const narrowed = useQuery({ ...workQuery(login, search.from, search.to, search.filter ?? null), enabled: gated && !!search.filter }).data;
  if (!base || !isWorkGate(base)) return null;
  if (!search.filter) return base;
  return narrowed && isWorkGate(narrowed) ? narrowed : null;
}

function Proof({ login, name, self, search }: { login: string; name: string; self: boolean; search: Search }) {
  const gate = useGate(login, search);
  const [asking, setAsking] = useState(false);
  const [picking, setPicking] = useState(false);
  const open = useCallback(() => setAsking(true), []);
  const shorter = useCallback(() => setPicking(true), []);
  return (
    <Page className="flex flex-col gap-gutter pb-16">
      <PageHead
        media={<Face login={login} name={name} size={48} />}
        eyebrow={
          <Link to="/u/$login" params={{ login }} className="inline-flex items-center gap-1 text-secondary no-underline hover:text-primary">
            <ArrowLeft size={14} aria-hidden /> {name}
          </Link>
        }
        title={self ? "Your Proof of Work" : `${name}'s Proof of Work`}
        description={
          self
            ? "Every pull request you merged and every commit you made, with links. Your private work shows to you alone, and goes into a shared link only if you choose it."
            : "Every pull request they merged and every commit they made, with links. Public work only."
        }
        actions={<Actions login={login} search={search} self={self} ask={gate ? open : null} />}
      />
      <Filters login={login} search={search} picking={picking} onPicking={setPicking} />
      <Section fallback={<WorkSkeleton />}>
        <Results login={login} search={search} onAsk={open} onShorter={shorter} />
      </Section>
      <SignInForWork
        gate={gate}
        isOpen={asking && !!gate}
        onOpenChange={setAsking}
        onShorter={() => {
          setAsking(false);
          setPicking(true);
        }}
      />
    </Page>
  );
}

const here = () => (typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`);

function SignInForWork({ gate, isOpen, onOpenChange, onShorter }: { gate: WorkGate | null; isOpen: boolean; onOpenChange: (open: boolean) => void; onShorter: () => void }) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={520} padding={5} purpose="info">
      {isOpen && gate && (
        <>
          <DialogHeader title={gate.signedIn ? "Sign in again to read this much work" : "Sign in to read this much work"} onOpenChange={onOpenChange} />
          <SignInWords gate={gate} onShorter={onShorter} />
        </>
      )}
    </Dialog>
  );
}

function SignInWords({ gate, onShorter }: { gate: WorkGate; onShorter: () => void }) {
  return (
    <div className="flex flex-col gap-stack pt-4">
      <p className="m-0 type-body">
        This period, {periodWords(gate.from, gate.to)}
        {gate.filter ? `, in ${gate.filter},` : ","} holds {gate.atLeast ? "at least" : "about"} {grouped(gate.prs + gate.commits)} merged pull requests and commits. Reading every one of them takes {gate.atLeast ? "at least" : "about"} {many(gate.requests, "request", "requests")} to GitHub.
      </p>
      <p className="m-0 type-description">
        {gate.signedIn ? "GitHub no longer accepts your sign-in for reading, so" : "Without signing in,"} {PRODUCT} reads GitHub with one allowance that every visitor shares, and it reads no more than {gate.budget} requests for one Proof of Work. Sign in with GitHub{gate.signedIn ? " again" : ""} and it reads this one with your own GitHub allowance instead. It only reads; it never changes anything on GitHub.
      </p>
      <div className="flex flex-wrap justify-end gap-cluster">
        <Button label="Pick a shorter period" variant="secondary" onClick={onShorter} />
        <Button label="Sign in with GitHub" variant="primary" icon={<Icon icon={LogIn} size="sm" />} onClick={() => signIn(here())} />
      </div>
    </div>
  );
}

function Gated({ gate, onAsk, onShorter }: { gate: WorkGate; onAsk: () => void; onShorter: () => void }) {
  useEffect(() => onAsk(), [onAsk]);
  return (
    <Panel
      title={gate.signedIn ? "This period needs you to sign in again" : "This period needs a sign-in"}
      description={`${many(gate.prs, "merged pull request", "merged pull requests")} and ${gate.atLeast ? "at least" : "about"} ${many(gate.commits, "commit", "commits")}${gate.filter ? ` in ${gate.filter}` : ""}: reading them takes ${gate.atLeast ? "at least" : "about"} ${many(gate.requests, "request", "requests")} to GitHub, more than the ${gate.budget} the Site's shared allowance gives one Proof of Work. Sign in${gate.signedIn ? " again" : ""} to read it with your own GitHub allowance, or pick a shorter period or one repository.`}
    >
      <div className="flex flex-wrap gap-cluster">
        <Button label="Sign in with GitHub" variant="primary" icon={<Icon icon={LogIn} size="sm" />} onClick={() => signIn(here())} />
        <Button label="Pick a shorter period" variant="secondary" onClick={onShorter} />
        <Button label="Why?" variant="ghost" onClick={onAsk} />
      </div>
    </Panel>
  );
}

function Actions({ login, search, self, ask }: { login: string; search: Search; self: boolean; ask: (() => void) | null }) {
  const { origin } = Route.useLoaderData();
  const toast = useToast();
  const query = queryOf(search);
  const copy = () => (ask ? ask() : void navigator.clipboard?.writeText(`${origin}/u/${login}/work?${query}`).then(() => toast(self ? "Link copied. Others who open it see your public work." : "Link copied")));
  const download = (file: string) => (ask ? { onClick: ask } : { href: `/api/work/u/${login}/${file}?${query}` });
  return (
    <>
      <Button label="Copy link" variant="secondary" icon={<Icon icon={Link2} size="sm" />} onClick={copy} />
      {self && <ShareWork login={login} search={search} />}
      <span className="hidden h-6 w-px bg-line sm:block" aria-hidden />
      <Button label="Markdown" variant="secondary" icon={<Icon icon={Download} size="sm" />} {...download("proof.md")} tooltip="Download as Markdown" />
      <Button label="PDF" variant="secondary" icon={<Icon icon={Download} size="sm" />} {...download("proof.pdf")} tooltip="Download as PDF" />
    </>
  );
}

function ShareWork({ login, search }: { login: string; search: Search }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button label="Share" variant="primary" icon={<Icon icon={Share2} size="sm" />} onClick={() => setOpen(true)} />
      <Dialog isOpen={open} onOpenChange={setOpen} width={520} padding={5} purpose="form">
        <DialogHeader title="Share this Proof of Work" onOpenChange={setOpen} />
        {open && (
          <Section fallback={<Skeleton height={160} />}>
            <ShareChoices login={login} search={search} />
          </Section>
        )}
      </Dialog>
    </>
  );
}

function ShareChoices({ login, search }: { login: string; search: Search }) {
  const { data: read } = useSuspenseQuery(workQuery(login, search.from, search.to, search.filter ?? null));
  if (isWorkGate(read)) return <p className="m-0 pt-4 type-description">GitHub no longer accepts your sign-in for reading this period. Sign out and in again, then share it.</p>;
  return <ShareForm login={login} search={search} work={read} />;
}

function ShareForm({ login, search, work }: { login: string; search: Search; work: Work }) {
  const { origin } = Route.useLoaderData();
  const toast = useToast();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [link, setLink] = useState<string | null>(null);
  const privateRepos = [...new Map(groupWork(work.items).flatMap((m) => m.repositories.filter((r) => r.private).map((r) => [r.repo, 0] as const))).keys()].map((repo) => ({ repo, count: work.items.filter((i) => i.repo === repo).length }));
  const copy = (url: string) => void navigator.clipboard?.writeText(url).then(() => toast("Link copied"));
  const share = useMutation({
    mutationFn: () => shareMyWork({ data: { login, from: search.from, to: search.to, filter: search.filter ?? null, privateRepos: [...chosen] } }),
    onSuccess: ({ id }) => {
      const url = `${origin}/u/${login}/work/${id}`;
      setLink(url);
      copy(url);
    },
  });
  if (link)
    return (
      <div className="flex flex-col gap-4 pt-4">
        <p className="m-0 type-description">This link opens the Proof of Work as it is now, and stays the same if your work changes. Delete it from its page at any time.</p>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextInput label="Link" value={link} isReadOnly width="100%" />
          </div>
          <Button label="Copy" variant="primary" icon={<Icon icon={Copy} size="sm" />} onClick={() => copy(link)} />
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-4 pt-4">
      <p className="m-0 type-description">
        A link that keeps this Proof of Work as it is now, from {work.from} to {work.to}. Public work is always in it.{" "}
        {privateRepos.length > 0 ? "Choose the private repositories it may name; the others stay out." : "Nothing private is in this period, so it holds exactly what others see."}
      </p>
      {privateRepos.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-md border border-line p-0">
          {privateRepos.map((r) => (
            <li key={r.repo} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <CheckboxInput
                label={r.repo}
                labelIcon={<Lock size={12} aria-hidden />}
                value={chosen.has(r.repo)}
                onChange={(on) => setChosen((s) => (on ? new Set([...s, r.repo]) : new Set([...s].filter((x) => x !== r.repo))))}
              />
              <span className="flex-none type-caption tnum">{many(r.count, "item", "items")}</span>
            </li>
          ))}
        </ul>
      )}
      {share.error && <p className="m-0 text-sm text-removed">{share.error.message}</p>}
      <div className="flex justify-end">
        <Button
          label={chosen.size > 0 ? `Create a link with ${many(chosen.size, "private repository", "private repositories")}` : privateRepos.length > 0 ? "Create a link with public work only" : "Create the link"}
          variant="primary"
          isLoading={share.isPending}
          onClick={() => share.mutate()}
        />
      </div>
    </div>
  );
}

function Filters({ login, search, picking, onPicking }: { login: string; search: Search; picking: boolean; onPicking: (open: boolean) => void }) {
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <div className="flex flex-col gap-cluster sm:flex-row sm:flex-wrap sm:items-center" role="group" aria-label="What to show">
      <PeriodPicker from={search.from} to={search.to} isOpen={picking} onOpenChange={onPicking} onChange={(p) => void navigate({ search: (s) => ({ ...s, ...p, kind: undefined }) })} />
      <Quiet key={`${search.from}:${search.to}`} fallback={<RepoPicker items={[]} value={search.filter ?? null} disabled onChange={() => undefined} />}>
        <Places login={login} search={search} />
      </Quiet>
    </div>
  );
}

class Quiet extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : <Suspense fallback={this.props.fallback}>{this.props.children}</Suspense>;
  }
}

function Places({ login, search }: { login: string; search: Search }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: base } = useSuspenseQuery(workQuery(login, search.from, search.to, null));
  const choose = (filter: string | null) => void navigate({ search: (s) => ({ ...s, filter: filter ?? undefined, kind: undefined }) });
  if (isWorkGate(base)) return <RepoPicker items={base.repositories.map((r) => ({ repo: r.repo, count: r.commits }))} noun={["commit", "commits"]} all={`${base.atLeast ? "at least" : "about"} ${many(base.commits, "commit", "commits")}`} value={search.filter ?? null} onChange={choose} />;
  return <RepoPicker items={base.items} value={search.filter ?? null} onChange={choose} />;
}

type Asking = { onAsk: () => void; onShorter: () => void };

function Results({ login, search, onAsk, onShorter }: { login: string; search: Search } & Asking) {
  const { data: base } = useSuspenseQuery(workQuery(login, search.from, search.to, null));
  if (isWorkGate(base)) return search.filter ? <Narrowed login={login} search={search} onAsk={onAsk} onShorter={onShorter} /> : <Gated gate={base} onAsk={onAsk} onShorter={onShorter} />;
  const work: Work = search.filter ? { ...base, filter: search.filter, items: base.items.filter((i) => inFilter(i, search.filter ?? null)) } : base;
  return <Shown work={work} search={search} />;
}

function Narrowed({ login, search, onAsk, onShorter }: { login: string; search: Search } & Asking) {
  const { data: read } = useSuspenseQuery(workQuery(login, search.from, search.to, search.filter ?? null));
  if (isWorkGate(read)) return <Gated gate={read} onAsk={onAsk} onShorter={onShorter} />;
  return <Shown work={read} search={search} />;
}

function Shown({ work, search }: { work: Work; search: Search }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const read = new Date(work.at * 1000).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const look: WorkLook = { group: search.group ?? "month", kind: search.kind ?? null };
  return (
    <WorkView
      work={work}
      look={look}
      onLook={(l) => void navigate({ search: (s) => ({ ...s, group: l.group === "repository" ? "repository" : undefined, kind: l.kind ?? undefined }), replace: true, resetScroll: false })}
      footer={`Read from GitHub on ${read} UTC. Pull requests are counted on the day they were merged. Commits are the ones on each repository's main branch today, on the day their author made them, so GitHub's own contribution count can be higher: it keeps commits that were later squashed or rewritten away.`}
    />
  );
}
