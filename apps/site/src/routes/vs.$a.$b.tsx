import { useState, type CSSProperties } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Popover } from "@astryxdesign/core/Popover";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeftRight, Crown, Pencil } from "lucide-react";
import { isLogin, PRODUCT, type Identity, type VersusRow } from "@commitscape/data";
import { avatarUrl, compact, grouped, hours, Page } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { Missing } from "#/components/Missing";
import { ShareButton } from "#/components/ShareDialog";
import { profileLookupQuery, versusQuery } from "#/lib/queries";

export const Route = createFileRoute("/vs/$a/$b")({
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

function shown(r: VersusRow, n: number | null): string {
  if (n === null) return "—";
  if (r.view === "hoursToMerge") return hours(n);
  if (r.view === "activeDays" || r.view === "longestStreak") return `${grouped(n)} ${n === 1 ? "day" : "days"}`;
  return n >= 100_000 ? compact(n) : grouped(n);
}

function VersusPage() {
  const { a, b } = Route.useParams();
  const { a: left, b: right } = Route.useLoaderData();
  const refused = [left, right].find((l) => l.status !== "ok");
  if (a.toLowerCase() === b.toLowerCase()) return <Missing title="A Versus needs two people" words={`Pick someone to put next to @${a}.`} back={{ label: "Pick two people", href: "/vs" }} />;
  if (refused) {
    const words = refused.status === "hidden" ? `@${refused.login} has chosen to stay out of comparisons.` : refused.status === "organization" ? `@${refused.login} is an organization, not a person.` : `GitHub has no person called @${refused.login}.`;
    return <Missing title="No Versus here" words={words} back={{ label: "Pick two people", href: "/vs" }} />;
  }
  if (left.status !== "ok" || right.status !== "ok") return null;
  return (
    <>
      <section className="versus-backdrop relative overflow-hidden border-b border-line" style={{ "--left": `url(${avatarUrl(left.identity.login, 64)})`, "--right": `url(${avatarUrl(right.identity.login, 64)})` } as CSSProperties}>
        <Page className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-10 sm:gap-8 sm:py-14">
          <Side identity={left.identity} other={right.identity.login} side="a" />
          <div className="flex flex-col items-center gap-3">
            <span className="vs-badge grid size-14 place-items-center rounded-full text-lg font-bold tracking-tight sm:size-[4rem]">VS</span>
            <Link to="/vs/$a/$b" params={{ a: right.identity.login, b: left.identity.login }} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-secondary no-underline hover:text-primary" aria-label="Swap sides">
              <ArrowLeftRight size={13} /> Swap
            </Link>
          </div>
          <Side identity={right.identity} other={left.identity.login} side="b" />
        </Page>
      </section>
      <Page width="narrow" className="flex flex-col gap-6 py-10">
        <Section fallback={<BoardSkeleton />}>
          <Board a={left.identity.login} b={right.identity.login} />
        </Section>
      </Page>
    </>
  );
}

function Side({ identity, other, side }: { identity: Pick<Identity, "login" | "name">; other: string; side: "a" | "b" }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const right = side === "b";
  return (
    <div className={`flex min-w-0 flex-col items-center gap-3 text-center sm:flex-row sm:text-start ${right ? "sm:flex-row-reverse sm:text-end" : ""}`}>
      <Link to="/u/$login" params={{ login: identity.login }} className="flex-none rounded-full">
        <img src={avatarUrl(identity.login, 96)} alt="" width={96} height={96} className="size-[4rem] rounded-full bg-muted shadow-[0_0_0_4px_var(--color-background-body)] sm:size-[6rem]" />
      </Link>
      <div className={`flex min-w-0 flex-col gap-1 ${right ? "sm:items-end" : ""}`}>
        <Link to="/u/$login" params={{ login: identity.login }} className="truncate text-lg font-semibold tracking-tight text-primary no-underline hover:underline sm:text-2xl">
          {identity.name ?? identity.login}
        </Link>
        <div className={`flex items-center gap-1 text-sm text-secondary ${right ? "sm:flex-row-reverse" : ""}`}>
          <span className="truncate">@{identity.login}</span>
          <Popover
            isOpen={open}
            onOpenChange={setOpen}
            label="Put someone else here"
            width={280}
            alignment={right ? "end" : "start"}
            content={
              <form
                className="flex flex-col gap-3 p-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const login = text.trim().replace(/^@/, "");
                  if (!isLogin(login)) return;
                  setOpen(false);
                  void navigate({ to: "/vs/$a/$b", params: side === "a" ? { a: login, b: other } : { a: other, b: login } });
                }}
              >
                <TextInput label="Someone else" placeholder="a GitHub username" value={text} onChange={setText} hasAutoFocus />
                <Button label="Compare" variant="primary" size="sm" type="submit" />
              </form>
            }
          >
            <Button label="Change" isIconOnly size="sm" variant="ghost" icon={<Icon icon={Pencil} size="sm" />} tooltip="Put someone else here" />
          </Popover>
        </div>
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} height={64} index={i} radius={3} />
      ))}
    </div>
  );
}

function Board({ a, b }: { a: string; b: string }) {
  const { origin } = Route.useLoaderData();
  const { data: v } = useSuspenseQuery(versusQuery(a, b));
  const known = v.rows.filter((r) => r.a !== null || r.b !== null);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-xl font-semibold tracking-tight">View by view</h1>
          <p className="m-0 text-sm text-secondary">A winner for each view and none overall: each counts something different.</p>
        </div>
        <ShareButton
          origin={origin}
          title="Share this Versus"
          choices={[
            {
              id: "versus",
              title: "Versus",
              about: "Two people side by side.",
              url: `/api/cards/vs/${v.a.identity.login}/${v.b.identity.login}/versus`,
              width: 640,
              height: 170 + known.length * 34,
              link: `/vs/${v.a.identity.login}/${v.b.identity.login}`,
              share: `@${v.a.identity.login} versus @${v.b.identity.login}, view by view.`,
              alt: `${v.a.identity.login} versus ${v.b.identity.login}`,
            },
          ]}
        />
      </div>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {v.rows.map((r, i) => (
          <Row key={r.view} r={r} index={i} />
        ))}
      </ol>
      <p className="m-0 text-center text-xs text-secondary">
        — means not known for one of them. Lines that still run count only repositories commitscape has read.
      </p>
    </>
  );
}

function Row({ r, index }: { r: VersusRow; index: number }) {
  const most = Math.max(r.a ?? 0, r.b ?? 0, 1);
  const width = (n: number | null) => (n === null ? 0 : r.view === "hoursToMerge" ? (Math.min(r.a ?? Infinity, r.b ?? Infinity) / Math.max(n, 0.01)) * 100 : (n * 100) / most);
  const bar = (side: "a" | "b") => {
    const n = side === "a" ? r.a : r.b;
    const win = r.winner === side;
    return <span className={`block h-2 rounded-full transition-[width] duration-700 ${win ? "bg-brand" : "bg-[var(--color-text-secondary)] opacity-35"}`} style={{ width: `${Math.max(n ? 3 : 0, width(n))}%` }} />;
  };
  const value = (side: "a" | "b") => {
    const n = side === "a" ? r.a : r.b;
    const win = r.winner === side;
    return (
      <span className={`inline-flex items-center gap-1.5 text-[0.95rem] whitespace-nowrap tnum sm:text-lg ${win ? "font-semibold text-primary" : "text-secondary"} ${side === "b" ? "flex-row-reverse" : ""}`}>
        {win && <Crown size={14} className="text-brand" aria-label="leads this view" />}
        {shown(r, n)}
      </span>
    );
  };
  return (
    <li className="rise grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-[var(--radius-container)] border border-line bg-surface px-4 py-3 sm:gap-6 sm:px-5" style={{ animationDelay: `${index * 40}ms` }}>
      <div className="flex flex-col items-start gap-2">
        {value("a")}
        <span className="flex w-full justify-end">{bar("a")}</span>
      </div>
      <span className="w-28 text-center text-xs font-medium text-secondary sm:w-40">
        {r.label}
        {r.winner === "tie" && <span className="block text-[0.7rem]">a tie</span>}
      </span>
      <div className="flex flex-col items-end gap-2">
        {value("b")}
        <span className="flex w-full justify-start">{bar("b")}</span>
      </div>
    </li>
  );
}
