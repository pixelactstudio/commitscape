import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import type { ISODateString } from "@astryxdesign/core/Calendar";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Copy, Download, Link2, Lock, Search, Share2 } from "lucide-react";
import { groupWork, periodDates, PERIODS, PRODUCT, type Period, type Work } from "@commitscape/data";
import { Face, many, Page, PageHead, WorkSkeleton, WorkView } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { Missing } from "#/components/Missing";
import { shareMyWork } from "#/functions/work";
import { profileLookupQuery, workQuery } from "#/lib/queries";
import { useToast } from "#/lib/toast";

type Search = { from: string; to: string; filter?: string };
type Iso = ISODateString;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const SHORT: Record<Period, string> = { "last-month": "Last month", "this-month": "This month", "last-3-months": "3 months", "this-year": "This year", "last-year": "Last year" };

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

const queryOf = (search: Search) => new URLSearchParams({ from: search.from, to: search.to, ...(search.filter ? { filter: search.filter } : {}) }).toString();

function ProofOfWork() {
  const { login } = Route.useParams();
  const search = Route.useSearch();
  const { data: lookup } = useSuspenseQuery(profileLookupQuery(login));
  if (lookup.status === "hidden") return <Missing title="This Proof of Work is hidden" words="This person has chosen to stay out, so their Proof of Work shows nothing." />;
  if (lookup.status !== "ok") return <Missing title={`No one called @${login}`} words="GitHub has no person by that name. Check its spelling, or search for them." />;
  const id = lookup.identity;
  const name = id.name ?? id.login;
  return (
    <Page className="flex flex-col gap-4 pb-16">
      <PageHead
        media={<Face login={id.login} name={name} size={48} />}
        eyebrow={
          <Link to="/u/$login" params={{ login: id.login }} className="inline-flex items-center gap-1 text-secondary no-underline hover:text-primary">
            <ArrowLeft size={14} aria-hidden /> {name}
          </Link>
        }
        title={lookup.self ? "Your Proof of Work" : `${name}'s Proof of Work`}
        description={
          lookup.self
            ? "Every pull request merged and every commit, by month and repository, with links. Your private work shows to you alone, and goes into a shared link only if you choose it."
            : "Every pull request merged and every commit, by month and repository, with links. Public work only."
        }
        actions={<Actions login={id.login} search={search} self={lookup.self} />}
      />
      <Filters key={`${search.from}${search.to}${search.filter ?? ""}`} search={search} />
      <Section fallback={<WorkSkeleton />}>
        <Results login={id.login} search={search} />
      </Section>
    </Page>
  );
}

function Actions({ login, search, self }: { login: string; search: Search; self: boolean }) {
  const { origin } = Route.useLoaderData();
  const toast = useToast();
  const query = queryOf(search);
  const copy = () => void navigator.clipboard?.writeText(`${origin}/u/${login}/work?${query}`).then(() => toast(self ? "Link copied. Others who open it see your public work." : "Link copied"));
  return (
    <>
      <Button label="Copy link" variant="secondary" icon={<Icon icon={Link2} size="sm" />} onClick={copy} />
      {self && <ShareWork login={login} search={search} />}
      <span className="hidden h-6 w-px bg-[var(--color-border)] sm:block" aria-hidden />
      <Button label="Markdown" variant="secondary" icon={<Icon icon={Download} size="sm" />} href={`/api/work/u/${login}/proof.md?${query}`} tooltip="Download as Markdown" />
      <Button label="PDF" variant="secondary" icon={<Icon icon={Download} size="sm" />} href={`/api/work/u/${login}/proof.pdf?${query}`} tooltip="Download as PDF" />
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
  const { origin } = Route.useLoaderData();
  const toast = useToast();
  const { data: work } = useSuspenseQuery(workQuery(login, search.from, search.to, search.filter ?? null));
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
        <p className="m-0 text-sm text-secondary">This link opens the Proof of Work as it is now, and stays the same if your work changes. Delete it from its page at any time.</p>
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
      <p className="m-0 text-sm text-pretty text-secondary">
        A link that keeps this Proof of Work as it is now, from {work.from} to {work.to}. Public work is always in it.{" "}
        {privateRepos.length > 0 ? "Choose the private repositories it may name; the others stay out." : "Nothing private is in this period, so it holds exactly what others see."}
      </p>
      {privateRepos.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius-element)] border border-line p-0">
          {privateRepos.map((r) => (
            <li key={r.repo} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <CheckboxInput
                label={r.repo}
                labelIcon={<Lock size={12} aria-hidden />}
                value={chosen.has(r.repo)}
                onChange={(on) => setChosen((s) => (on ? new Set([...s, r.repo]) : new Set([...s].filter((x) => x !== r.repo))))}
              />
              <span className="flex-none text-xs text-secondary tnum">{many(r.count, "item", "items")}</span>
            </li>
          ))}
        </ul>
      )}
      {share.error && <p className="m-0 text-sm text-[var(--color-text-error)]">{share.error.message}</p>}
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

function Filters({ search }: { search: Search }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const [from, setFrom] = useState(search.from);
  const [to, setTo] = useState(search.to);
  const [filter, setFilter] = useState(search.filter ?? "");
  const preset = PERIODS.find(([p]) => {
    const d = periodDates(p);
    return d.from === search.from && d.to === search.to;
  })?.[0];
  const pick = (v: string) => {
    if (v === "custom") return;
    void navigate({ search: { ...periodDates(v as Period), ...(search.filter ? { filter: search.filter } : {}) } });
  };
  const changed = from !== search.from || to !== search.to || filter.trim() !== (search.filter ?? "");
  return (
    <form
      className="flex flex-col gap-4 rounded-[var(--radius-container)] border border-line bg-surface p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (from > to) return;
        void navigate({ search: { from, to, ...(filter.trim() ? { filter: filter.trim() } : {}) } });
      }}
    >
      <div className="hidden md:block">
        <SegmentedControl label="Period" value={preset ?? "custom"} onChange={pick}>
          {PERIODS.map(([value]) => (
            <SegmentedControlItem key={value} value={value} label={SHORT[value]} />
          ))}
          <SegmentedControlItem value="custom" label="These dates" />
        </SegmentedControl>
      </div>
      <div className="md:hidden">
        <Selector label="Period" value={preset ?? "custom"} onChange={pick} options={[...PERIODS.map(([value, label]) => ({ value, label })), { value: "custom", label: "These dates" }]} width="100%" />
      </div>
      <div className="grid items-end gap-3 sm:grid-cols-2 md:flex md:flex-wrap">
        <div className="md:w-44">
          <DateInput label="From" value={from as Iso} max={to as Iso} onChange={(v) => v && setFrom(v)} format="date" width="100%" />
        </div>
        <div className="md:w-44">
          <DateInput label="To" value={to as Iso} min={from as Iso} onChange={(v) => v && setTo(v)} format="date" width="100%" />
        </div>
        <div className="sm:col-span-2 md:w-64">
          <TextInput label="Only in" placeholder="an organisation, or owner/repo" value={filter} onChange={setFilter} startIcon={Search} hasClear width="100%" />
        </div>
        <div className="sm:col-span-2 md:col-span-1">
          <Button label="Show" variant={changed ? "primary" : "secondary"} type="submit" width="100%" />
        </div>
      </div>
    </form>
  );
}

function Results({ login, search }: { login: string; search: Search }) {
  const { data: work } = useSuspenseQuery(workQuery(login, search.from, search.to, search.filter ?? null));
  const read = new Date(work.at * 1000).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return <WorkView work={work as Work} footer={`Read from GitHub on ${read} UTC. Pull requests are counted on the day they were merged, commits on the day their author made them.`} />;
}
