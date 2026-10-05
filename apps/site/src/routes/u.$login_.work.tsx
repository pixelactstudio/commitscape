import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Copy, Download, Link2, Lock, Share2 } from "lucide-react";
import { groupWork, inFilter, periodDates, PRODUCT, WORK_KINDS, type Work, type WorkKind } from "@commitscape/data";
import { Face, many, Page, PageHead, PeriodPicker, RepoPicker, WorkSkeleton, WorkView, type WorkLook } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { Missing } from "#/components/Missing";
import { shareMyWork } from "#/functions/work";
import { profileLookupQuery, workQuery } from "#/lib/queries";
import { useToast } from "#/lib/toast";

type Search = { from: string; to: string; filter?: string; group?: "repository"; kind?: WorkKind };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/u/$login_/work")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const last = periodDates("last-month");
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
            ? "Every pull request you merged and every commit you made, with links. Your private work shows to you alone, and goes into a shared link only if you choose it."
            : "Every pull request they merged and every commit they made, with links. Public work only."
        }
        actions={<Actions login={id.login} search={search} self={lookup.self} />}
      />
      <Filters login={id.login} search={search} />
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

function Filters({ login, search }: { login: string; search: Search }) {
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="What to show">
      <PeriodPicker from={search.from} to={search.to} onChange={(p) => void navigate({ search: (s) => ({ ...s, ...p, kind: undefined }) })} />
      <Section
        fallback={
          <div className="w-full sm:w-[260px]">
            <Selector label="Only in" isLabelHidden options={[]} placeholder="Every repository" isDisabled width="100%" />
          </div>
        }
      >
        <Places login={login} search={search} />
      </Section>
    </div>
  );
}

function Places({ login, search }: { login: string; search: Search }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: base } = useSuspenseQuery(workQuery(login, search.from, search.to, null));
  return <RepoPicker items={base.items} value={search.filter ?? null} onChange={(filter) => void navigate({ search: (s) => ({ ...s, filter: filter ?? undefined, kind: undefined }) })} />;
}

function Results({ login, search }: { login: string; search: Search }) {
  const { data: base } = useSuspenseQuery(workQuery(login, search.from, search.to, null));
  if (search.filter && base.truncated) return <Narrowed login={login} search={search} />;
  const work: Work = search.filter ? { ...base, filter: search.filter, items: base.items.filter((i) => inFilter(i, search.filter ?? null)) } : base;
  return <Shown work={work} search={search} />;
}

function Narrowed({ login, search }: { login: string; search: Search }) {
  const { data: work } = useSuspenseQuery(workQuery(login, search.from, search.to, search.filter ?? null));
  return <Shown work={work} search={search} />;
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
      footer={`Read from GitHub on ${read} UTC. Pull requests are counted on the day they were merged, commits on the day their author made them.`}
    />
  );
}
