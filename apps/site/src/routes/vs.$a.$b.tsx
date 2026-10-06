import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Popover } from "@astryxdesign/core/Popover";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { Award, Pencil } from "lucide-react";
import { isLogin, PRODUCT, type Identity, type VersusFull, type VersusRow } from "@commitscape/data";
import { Nothing } from "@commitscape/ui/motion";
import { ICON } from "@commitscape/ui/design";
import { Chip, compact, DuelRows, Face, grouped, hours, Page, PanelSkeleton, TipLayer, TONE, VersusSections, type Duel, type Side } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { Missing } from "#/components/Missing";
import { ShareButton } from "#/components/ShareDialog";
import { profileLookupQuery, versusQuery } from "#/lib/queries";

type Search = { view?: string };

const DAY = 24 * 3600;

export const Route = createFileRoute("/vs/$a/$b")({
  validateSearch: (s: Record<string, unknown>): Search => (s.view === undefined ? {} : { view: String(s.view) }),
  beforeLoad: ({ search, params }) => {
    if (search.view !== undefined) throw redirect({ to: "/vs/$a/$b", params, search: {}, replace: true, statusCode: 301 });
  },
  loader: async ({ params, context }) => {
    const [a, b] = await Promise.all([context.queryClient.ensureQueryData(profileLookupQuery(params.a)), context.queryClient.ensureQueryData(profileLookupQuery(params.b))]);
    if (a.status === "ok" && b.status === "ok" && params.a.toLowerCase() !== params.b.toLowerCase()) {
      const kept = [a, b].every((l) => l.status === "ok" && l.fetchedAt !== null && l.fetchedAt > Date.now() / 1000 - DAY);
      const versus = versusQuery(params.a, params.b);
      if (kept) await context.queryClient.ensureQueryData(versus).catch(() => undefined);
      else void context.queryClient.prefetchQuery(versus);
    }
    return { a, b, origin: context.origin ?? "" };
  },
  head: ({ params, loaderData }) => ({
    meta: [
      { title: `@${params.a} versus @${params.b} · ${PRODUCT}` },
      { property: "og:title", content: `@${params.a} versus @${params.b}` },
      { property: "og:description", content: "Two developers side by side, a winner for each view and none overall." },
      { property: "og:image", content: `${loaderData?.origin ?? ""}/api/cards/vs/${params.a}/${params.b}/versus.png` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VersusPage,
});

function shown(r: VersusRow): (n: number) => string {
  if (r.view === "hoursToMerge") return hours;
  if (r.view === "activeDays" || r.view === "longestStreak") return (n) => `${grouped(n)} ${Math.round(n) === 1 ? "day" : "days"}`;
  return (n) => (n >= 100_000 ? compact(n) : grouped(n));
}

const duels = (rows: VersusRow[]): Duel[] => rows.map((r) => ({ key: r.view, label: r.label, a: r.a, b: r.b, winner: r.winner, lowerWins: r.view === "hoursToMerge", format: shown(r) }));

function VersusPage() {
  const { a, b } = Route.useParams();
  const { a: left, b: right } = Route.useLoaderData();
  const refused = [left, right].find((l) => l.status !== "ok");
  if (a.toLowerCase() === b.toLowerCase()) return <Missing title="A Versus needs two people" words={`Pick someone to put next to @${a}.`} back={{ label: "Pick two people", href: "/vs" }} />;
  if (refused) {
    const words = refused.status === "hidden" ? `@${refused.login} has chosen to stay out of comparisons.` : refused.status === "organization" ? `@${refused.login} is an organization, not a person.` : `GitHub has no person called @${refused.login}.`;
    const kept = [left, right].find((l) => l.status === "ok");
    if (kept?.status === "ok") return <NoVersus words={words} kept={kept.identity} side={kept === left ? "a" : "b"} />;
    return <Missing title="No Versus here" words={words} back={{ label: "Pick two people", href: "/vs" }} />;
  }
  if (left.status !== "ok" || right.status !== "ok") return null;
  return (
    <TipLayer>
      <section className="versus-stage relative overflow-hidden border-b border-line">
        <h1 className="sr-only">
          {left.identity.login} versus {right.identity.login}
        </h1>
        <Page className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 pt-page-top pb-10 sm:items-center sm:gap-6 sm:pb-12">
          <Corner identity={left.identity} other={right.identity.login} side="a" />
          <span className="vs-badge rise mt-6 grid size-11 place-items-center rounded-full text-xs font-bold sm:mt-0 sm:size-14 sm:text-base">VS</span>
          <Corner identity={right.identity} other={left.identity.login} side="b" />
        </Page>
      </section>
      <Page className="flex flex-col gap-section pt-page-top pb-16">
        <section aria-labelledby="views" className="flex flex-col gap-stack">
          <div className="flex flex-wrap items-end justify-between gap-cluster">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id="views" className="m-0 type-heading">
                View by view
              </h2>
              <p className="m-0 type-description">A winner for each view and none overall: each counts something different.</p>
            </div>
            <Section fallback={<Skeleton width={84} height={32} radius={2} />}>
              <Share a={left.identity.login} b={right.identity.login} />
            </Section>
          </div>
          <Section fallback={<DuelSkeleton />}>
            <Views />
          </Section>
        </section>
        <Section fallback={<SectionsSkeleton />}>
          <Sections />
        </Section>
        <p className="m-0 text-center type-micro">Numbers come from GitHub's public record and the repositories commitscape has read.</p>
      </Page>
    </TipLayer>
  );
}

function Corner({ identity, other, side }: { identity: Pick<Identity, "login" | "name">; other: string; side: Side }) {
  const right = side === "b";
  return (
    <div className={`rise flex min-w-0 flex-col items-center gap-4 text-center sm:flex-row sm:gap-6 ${right ? "sm:flex-row-reverse sm:text-end" : "sm:text-start"}`}>
      <Link to="/u/$login" params={{ login: identity.login }} className="flex flex-none rounded-full" aria-label={`@${identity.login}'s Profile`}>
        <Face login={identity.login} name={identity.name ?? identity.login} size={72} wide={128} ring={TONE[side]} glow />
      </Link>
      <div className={`flex min-w-0 max-w-full flex-col items-center gap-2 ${right ? "sm:items-end" : "sm:items-start"}`}>
        <Link to="/u/$login" params={{ login: identity.login }} className="max-w-full text-lg font-semibold tracking-snug break-words text-balance text-primary no-underline hover:underline sm:type-title">
          {identity.name ?? identity.login}
        </Link>
        <div className={`flex max-w-full items-center gap-0.5 type-caption ${right ? "sm:flex-row-reverse" : ""}`}>
          <span className="truncate font-medium">@{identity.login}</span>
          <Change side={side} other={other} />
        </div>
        <Section fallback={<Skeleton width={120} height={24} radius="rounded" />}>
          <Standout side={side} />
        </Section>
      </div>
    </div>
  );
}

function Change({ side, other }: { side: Side; other: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const login = text.trim().replace(/^@/, "");
  const valid = isLogin(login) && login.toLowerCase() !== other.toLowerCase();
  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      label="Put someone else here"
      width={280}
      alignment={side === "b" ? "end" : "start"}
      content={
        <form
          className="flex flex-col gap-3 p-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            setOpen(false);
            setText("");
            void navigate({ to: "/vs/$a/$b", params: side === "a" ? { a: login, b: other } : { a: other, b: login } });
          }}
        >
          <TextInput label={`Someone else on the ${side === "a" ? "left" : "right"}`} placeholder="a GitHub username" value={text} onChange={setText} hasAutoFocus />
          <Button label="Compare" variant="primary" size="sm" type="submit" isDisabled={!valid} />
        </form>
      }
    >
      <Button label="Put someone else here" isIconOnly size="sm" variant="ghost" icon={<Icon icon={Pencil} size="sm" />} tooltip="Put someone else here" />
    </Popover>
  );
}

function useVersus(): VersusFull {
  const { a, b } = Route.useParams();
  return useSuspenseQuery(versusQuery(a, b)).data;
}

function Standout({ side }: { side: Side }) {
  const v = useVersus();
  const main = v.people[side].archetypes[0];
  const ahead = v.rows.filter((r) => r.winner === side).map((r) => r.label);
  return (
    <div className={`fade flex max-w-full flex-col items-center gap-2 ${side === "b" ? "sm:items-end" : "sm:items-start"}`}>
      {main && (
        <span title={main.rule} className="max-w-full">
          <Chip icon={<Award size={ICON.xs} aria-hidden className="flex-none" style={{ color: TONE[side] }} />} className="max-w-full">
            <span className="truncate">{main.title}</span>
          </Chip>
        </span>
      )}
      {ahead.length > 0 && (
        <p className="m-0 hidden max-w-88 type-description sm:block">
          Ahead in <span className="text-primary">{ahead.join(", ").toLowerCase()}</span>
        </p>
      )}
    </div>
  );
}

function Share({ a, b }: { a: string; b: string }) {
  const { origin } = Route.useLoaderData();
  const v = useVersus();
  const known = v.rows.filter((r) => r.a !== null || r.b !== null);
  return (
    <ShareButton
      origin={origin}
      title="Share this Versus"
      choices={[
        {
          id: "versus",
          title: "Versus",
          about: "Two people side by side.",
          url: `/api/cards/vs/${a}/${b}/versus`,
          width: 640,
          height: 170 + known.length * 34,
          link: `/vs/${a}/${b}`,
          share: `@${a} versus @${b}, view by view.`,
          alt: `${a} versus ${b}`,
        },
      ]}
    />
  );
}

function DuelSkeleton() {
  return (
    <div className="grid overflow-hidden rounded-lg border border-line lg:grid-cols-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="-mb-px flex flex-col gap-2 border-b border-line px-5 py-3.5 lg:odd:border-e">
          <div className="flex items-center justify-between gap-3">
            <Skeleton width={70} height={18} radius={2} index={i} />
            <Skeleton width={110} height={12} radius={2} index={i} />
            <Skeleton width={70} height={18} radius={2} index={i} />
          </div>
          <Skeleton height={8} radius={4} index={i} />
        </div>
      ))}
    </div>
  );
}

function SectionsSkeleton() {
  return (
    <div className="flex flex-col gap-section">
      <PanelSkeleton title="The last year" height={150} />
      <PanelSkeleton title="Over the years" height={260} />
      <div className="grid gap-gutter lg:grid-cols-2">
        <PanelSkeleton title="Pull requests" height={360} />
        <PanelSkeleton title="Streaks and days" height={360} />
      </div>
    </div>
  );
}

function Views() {
  const v = useVersus();
  return (
    <>
      <DuelRows rows={duels(v.rows)} label="View by view" columns={2} />
      <p className="m-0 text-center type-caption">— means not known for one of them. Lines that still run count only repositories commitscape has read.</p>
    </>
  );
}

function Sections() {
  return <VersusSections v={useVersus()} />;
}

function NoVersus({ words, kept, side }: { words: string; kept: Pick<Identity, "login" | "name">; side: Side }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const login = text.trim().replace(/^@/, "");
  const valid = isLogin(login) && login.toLowerCase() !== kept.login.toLowerCase();
  return (
    <Page width="narrow" className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="flex items-center gap-4">
        <Face login={kept.login} name={kept.name ?? kept.login} size={72} ring={TONE[side]} glow />
        <span className="vs-badge grid size-11 place-items-center rounded-full text-xs font-bold">VS</span>
        <span className="grid size-18 place-items-center rounded-full border-2 border-dashed border-line-strong text-2xl font-semibold text-secondary">?</span>
      </div>
      <h1 className="m-0 type-title">No Versus here</h1>
      <Nothing compact title={words} words={`Put someone else next to ${kept.name ?? `@${kept.login}`}.`} />
      <form
        className="flex w-full max-w-md items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void navigate({ to: "/vs/$a/$b", params: side === "a" ? { a: kept.login, b: login } : { a: login, b: kept.login } });
        }}
      >
        <div className="min-w-0 flex-1 text-start">
          <TextInput label="Someone else" isLabelHidden placeholder="a GitHub username" value={text} onChange={setText} hasAutoFocus />
        </div>
        <Button label="Compare" variant="primary" type="submit" isDisabled={!valid} />
      </form>
      <Link to="/vs" className="type-caption no-underline hover:text-primary hover:underline">
        Or pick two other people
      </Link>
    </Page>
  );
}
