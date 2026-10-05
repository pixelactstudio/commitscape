import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Popover } from "@astryxdesign/core/Popover";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Award, LayoutList, Pencil, Rows3 } from "lucide-react";
import { isLogin, PRODUCT, type Identity, type VersusFull, type VersusRow } from "@commitscape/data";
import { Nothing } from "@commitscape/ui/motion";
import { avatarUrl, compact, DuelRows, grouped, hours, Page, TipLayer, toneOf, VersusSections, type Duel, type Side } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { Missing } from "#/components/Missing";
import { ShareButton } from "#/components/ShareDialog";
import { profileLookupQuery, versusQuery } from "#/lib/queries";

type Search = { view?: "full" };

export const Route = createFileRoute("/vs/$a/$b")({
  validateSearch: (s: Record<string, unknown>): Search => (s.view === "full" ? { view: "full" } : {}),
  loader: async ({ params, context }) => {
    const [a, b] = await Promise.all([context.queryClient.ensureQueryData(profileLookupQuery(params.a)), context.queryClient.ensureQueryData(profileLookupQuery(params.b))]);
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
  const { view } = Route.useSearch();
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
  const full = view === "full";
  return (
    <TipLayer>
      <section className="versus-stage relative overflow-hidden border-b border-line">
        <h1 className="sr-only">
          {left.identity.login} versus {right.identity.login}
        </h1>
        <Page className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 py-8 sm:items-center sm:gap-6 sm:py-12">
          <Corner identity={left.identity} other={right.identity.login} side="a" />
          <span className="vs-badge rise mt-5 grid size-11 place-items-center rounded-full text-sm font-bold tracking-tight sm:mt-0 sm:size-14 sm:text-base">VS</span>
          <Corner identity={right.identity} other={left.identity.login} side="b" />
        </Page>
      </section>
      <Page width={full ? "default" : "narrow"} className="flex flex-col gap-5 py-8 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-xl font-semibold tracking-tight">View by view</h2>
            <p className="m-0 text-sm text-secondary">A winner for each view and none overall: each counts something different.</p>
          </div>
          <div className="flex items-center gap-2">
            <ViewSwitch full={full} />
            <Section fallback={<Skeleton width={84} height={32} radius={2} />}>
              <Share a={left.identity.login} b={right.identity.login} />
            </Section>
          </div>
        </div>
        <Section fallback={<BoardSkeleton full={full} />}>
          <Board full={full} />
        </Section>
      </Page>
    </TipLayer>
  );
}

function ViewSwitch({ full }: { full: boolean }) {
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <SegmentedControl label="How much to show" size="sm" value={full ? "full" : "short"} onChange={(v) => void navigate({ search: v === "full" ? { view: "full" } : {}, resetScroll: false, replace: true })}>
      <SegmentedControlItem value="short" label="Short" icon={<LayoutList size={14} />} />
      <SegmentedControlItem value="full" label="Full" icon={<Rows3 size={14} />} />
    </SegmentedControl>
  );
}

function Corner({ identity, other, side }: { identity: Pick<Identity, "login" | "name">; other: string; side: Side }) {
  const right = side === "b";
  return (
    <div className={`rise flex min-w-0 flex-col items-center gap-3 text-center sm:flex-row sm:gap-5 ${right ? "sm:flex-row-reverse sm:text-end" : "sm:text-start"}`} style={toneOf(side)}>
      <Link to="/u/$login" params={{ login: identity.login }} className="vs-face flex-none rounded-full" aria-label={`@${identity.login}'s Profile`}>
        <img src={avatarUrl(identity.login, 128)} alt="" width={128} height={128} className="block size-[4.25rem] rounded-full bg-muted sm:size-[7rem]" />
      </Link>
      <div className={`flex min-w-0 max-w-full flex-col items-center gap-1.5 ${right ? "sm:items-end" : "sm:items-start"}`}>
        <Link to="/u/$login" params={{ login: identity.login }} className="max-w-full text-[1.05rem] leading-tight font-semibold tracking-[-0.02em] text-balance break-words text-primary no-underline hover:underline sm:text-[clamp(1.5rem,2.6vw,2.1rem)]">
          {identity.name ?? identity.login}
        </Link>
        <div className={`flex max-w-full items-center gap-0.5 text-sm text-secondary ${right ? "sm:flex-row-reverse" : ""}`}>
          <span className="truncate font-medium">@{identity.login}</span>
          <Change side={side} other={other} />
        </div>
        <Section fallback={<Skeleton width={120} height={26} radius="rounded" />}>
          <Standout side={side} />
        </Section>
      </div>
    </div>
  );
}

function Change({ side, other }: { side: Side; other: string }) {
  const navigate = useNavigate();
  const { view } = Route.useSearch();
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
            void navigate({ to: "/vs/$a/$b", params: side === "a" ? { a: login, b: other } : { a: other, b: login }, search: view ? { view } : {} });
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

function useVersus() {
  const { a, b } = Route.useParams();
  return useSuspenseQuery(versusQuery(a, b)).data;
}

function Standout({ side }: { side: Side }) {
  const v = useVersus();
  const p = v.people[side];
  const main = p.archetypes[0];
  const ahead = v.rows.filter((r) => r.winner === side).map((r) => r.label);
  return (
    <div className={`fade flex max-w-full flex-col items-center gap-2 ${side === "b" ? "sm:items-end" : "sm:items-start"}`}>
      {main && (
        <span className="vs-archetype inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.78rem] font-semibold" title={main.rule}>
          <Award size={13} aria-hidden className="flex-none" />
          <span className="truncate">{main.title}</span>
        </span>
      )}
      {ahead.length > 0 && (
        <p className="m-0 hidden max-w-[22rem] text-[0.8rem] text-pretty text-secondary sm:block">
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

function BoardSkeleton({ full }: { full: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col overflow-hidden rounded-[var(--radius-container)] border border-line">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 border-b border-line px-5 py-3.5 last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <Skeleton width={70} height={18} radius={2} index={i} />
              <Skeleton width={110} height={12} radius={2} index={i} />
              <Skeleton width={70} height={18} radius={2} index={i} />
            </div>
            <Skeleton height={8} radius={4} index={i} />
          </div>
        ))}
      </div>
      {full && <Skeleton height={260} radius={4} />}
    </div>
  );
}

function Board({ full }: { full: boolean }) {
  const v: VersusFull = useVersus();
  return (
    <>
      <div className={full ? "mx-auto w-full max-w-3xl" : ""}>
        <DuelRows rows={duels(v.rows)} label="View by view" />
      </div>
      <p className="m-0 text-center text-xs text-secondary">— means not known for one of them. Lines that still run count only repositories commitscape has read.</p>
      {full && <VersusSections v={v} />}
    </>
  );
}

function NoVersus({ words, kept, side }: { words: string; kept: Pick<Identity, "login" | "name">; side: Side }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const login = text.trim().replace(/^@/, "");
  const valid = isLogin(login) && login.toLowerCase() !== kept.login.toLowerCase();
  return (
    <Page width="narrow" className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="flex items-center gap-4">
        <span className="vs-face rounded-full" style={toneOf(side)}>
          <img src={avatarUrl(kept.login, 96)} alt="" width={72} height={72} className="block size-[4.5rem] rounded-full bg-muted" />
        </span>
        <span className="vs-badge grid size-11 place-items-center rounded-full text-sm font-bold">VS</span>
        <span className="grid size-[4.5rem] place-items-center rounded-full border-2 border-dashed border-strong text-2xl font-semibold text-secondary">?</span>
      </div>
      <h1 className="m-0 text-2xl font-semibold tracking-tight">No Versus here</h1>
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
      <Link to="/vs" className="text-sm text-secondary no-underline hover:text-primary hover:underline">
        Or pick two other people
      </Link>
    </Page>
  );
}
