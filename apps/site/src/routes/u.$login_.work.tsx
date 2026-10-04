import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { periodDates, PERIODS, PRODUCT, workSentence, type Period, type Work } from "@commitscape/data";
import { TilesSkeleton, WorkView } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { shareMyWork } from "#/functions/work";
import { profileLookupQuery, workQuery } from "#/lib/queries";

type Search = { from: string; to: string; filter?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/u/$login_/work")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const last = periodDates("last-month");
    const from = typeof s.from === "string" && DATE.test(s.from) ? s.from : last.from;
    const to = typeof s.to === "string" && DATE.test(s.to) ? s.to : last.to;
    return { from, to, ...(typeof s.filter === "string" && s.filter ? { filter: s.filter } : {}) };
  },
  loader: async ({ params, context }) => ({ lookup: await context.queryClient.ensureQueryData(profileLookupQuery(params.login)), origin: context.origin ?? "" }),
  head: ({ params }) => ({ meta: [{ title: `@${params.login}'s Proof of Work on ${PRODUCT}` }, { name: "robots", content: "noindex" }] }),
  component: ProofOfWork,
});

function ProofOfWork() {
  const { login } = Route.useParams();
  const search = Route.useSearch();
  const { data: lookup } = useSuspenseQuery(profileLookupQuery(login));
  if (lookup.status !== "ok") return <Banner status="warning" title={lookup.status === "hidden" ? "This person has chosen to stay out, so their Proof of Work is hidden." : "GitHub has no person by that name."} />;
  const name = lookup.identity.name ?? lookup.identity.login;
  return (
    <div className="flex flex-col gap-5 pb-8">
      <header className="repo-head">
        <div className="min-w-0 flex-1">
          <Heading level={1} className="repo-title">
            <a href={`/u/${lookup.identity.login}`}>{name}</a>'s Proof of Work
          </Heading>
          <p className="repo-facts note small">
            <span>Every pull request merged and every commit, by month and repository, with links. {lookup.self ? "Private work shows to you alone, and in a shared link only if you choose it." : "Public work only."}</span>
          </p>
        </div>
      </header>
      <Filters key={`${search.from}${search.to}${search.filter ?? ""}`} search={search} />
      <Section
        fallback={
          <>
            <TilesSkeleton count={4} className="profile-tiles" />
            <Skeleton height={600} />
          </>
        }
      >
        <Results login={lookup.identity.login} search={search} self={lookup.self} />
      </Section>
    </div>
  );
}

function Filters({ search }: { search: Search }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const [from, setFrom] = useState(search.from);
  const [to, setTo] = useState(search.to);
  const [filter, setFilter] = useState(search.filter ?? "");
  const preset = PERIODS.find(([p]) => {
    const d = periodDates(p);
    return d.from === search.from && d.to === search.to;
  })?.[0];
  const go = (next: Search) => void navigate({ search: next });
  return (
    <form
      className="work-filters"
      onSubmit={(e) => {
        e.preventDefault();
        go({ from, to, ...(filter.trim() ? { filter: filter.trim() } : {}) });
      }}
    >
      <Selector
        label="Period"
        size="md"
        value={preset ?? "custom"}
        onChange={(v) => {
          if (v === "custom") return;
          go({ ...periodDates(v as Period), ...(search.filter ? { filter: search.filter } : {}) });
        }}
        options={[...PERIODS.map(([value, label]) => ({ value, label })), { value: "custom", label: "These dates" }]}
        width={220}
      />
      <label className="work-field">
        <span>From</span>
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="work-field">
        <span>To</span>
        <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label className="work-field">
        <span>Only in</span>
        <input type="text" placeholder="an organisation, or owner/repo" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      <Button label="Show" variant="primary" type="submit" />
    </form>
  );
}

function Results({ login, search, self }: { login: string; search: Search; self: boolean }) {
  const { origin } = Route.useLoaderData();
  const { data: work } = useSuspenseQuery(workQuery(login, search.from, search.to, search.filter ?? null));
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const share = useMutation({
    mutationFn: () => shareMyWork({ data: { login, from: search.from, to: search.to, filter: search.filter ?? null, privateRepos: [...chosen] } }),
    onSuccess: ({ id }) => copy(`${origin}/u/${login}/work/${id}`),
  });
  const hasPrivate = work.items.some((i) => i.private);
  const query = new URLSearchParams({ from: search.from, to: search.to, ...(search.filter ? { filter: search.filter } : {}) }).toString();
  const page = `${origin}/u/${login}/work?${query}`;
  const copy = (link: string) => void navigator.clipboard?.writeText(link).then(() => setCopied(link));
  return (
    <>
      <div className="work-actions">
        <p className="note">{workSentence(work.items)}</p>
        <div className="actions">
          {!hasPrivate || !self ? (
            <Button label="Copy the link" variant="secondary" size="sm" onClick={() => copy(page)} />
          ) : (
            <Button label={chosen.size > 0 ? `Share with ${chosen.size} private repositor${chosen.size === 1 ? "y" : "ies"}` : "Share the public part"} variant="secondary" size="sm" isDisabled={share.isPending} onClick={() => share.mutate()} />
          )}
          <a className="card-link" href={`/api/work/u/${login}/proof.md?${query}`} download>
            Markdown
          </a>
          <a className="card-link" href={`/api/work/u/${login}/proof.pdf?${query}`} download>
            PDF
          </a>
        </div>
      </div>
      {copied && <Banner status="success" title={`Link copied: ${copied}`} />}
      {share.error && <Banner status="error" title={share.error.message} />}
      <WorkView work={work as Work} chosen={self && hasPrivate ? chosen : undefined} onChoose={(repo, on) => setChosen((s) => (on ? new Set([...s, repo]) : new Set([...s].filter((r) => r !== repo))))} />
    </>
  );
}
