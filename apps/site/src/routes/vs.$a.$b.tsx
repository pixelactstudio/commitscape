import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { isLogin, PRODUCT, type VersusRow } from "@commitscape/data";
import { Face, Figure } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { CardBox } from "#/components/CardBox";
import { profileLookupQuery, versusQuery } from "#/lib/queries";

export const Route = createFileRoute("/vs/$a/$b")({
  loader: async ({ params, context }) => {
    const [a, b] = await Promise.all([context.queryClient.ensureQueryData(profileLookupQuery(params.a)), context.queryClient.ensureQueryData(profileLookupQuery(params.b))]);
    return { a, b, origin: context.origin ?? "" };
  },
  head: ({ params, loaderData }) => ({
    meta: [
      { title: `@${params.a} versus @${params.b} on ${PRODUCT}` },
      { property: "og:title", content: `@${params.a} versus @${params.b}` },
      { property: "og:image", content: `${loaderData?.origin ?? ""}/api/cards/vs/${params.a}/${params.b}/versus.png` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VersusPage,
});

function hours(h: number): string {
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
}

function shown(r: VersusRow, n: number | null): string {
  if (n === null) return "—";
  if (r.view === "hoursToMerge") return hours(n);
  if (r.view === "activeDays" || r.view === "longestStreak") return `${n.toLocaleString("en-US")} ${n === 1 ? "day" : "days"}`;
  return n.toLocaleString("en-US");
}

function VersusPage() {
  const { a, b } = Route.useParams();
  const { a: left, b: right } = Route.useLoaderData();
  const refused = [left, right].find((l) => l.status !== "ok");
  if (refused) {
    return (
      <section className="flex flex-col items-start gap-4 py-12">
        <Heading level={1}>No Versus here</Heading>
        <Banner status="warning" title={refused.status === "hidden" ? `@${refused.login} has chosen to stay out of comparisons.` : refused.status === "organization" ? `@${refused.login} is an organization, not a person.` : `GitHub has no person called @${refused.login}.`} />
      </section>
    );
  }
  if (left.status !== "ok" || right.status !== "ok") return null;
  return (
    <div className="flex flex-col gap-5 pb-8">
      <header className="versus-head">
        <a href={`/u/${left.identity.login}`} className="versus-side">
          <Face login={left.identity.login} name={left.identity.name ?? left.identity.login} size={64} />
          <span>
            <strong>{left.identity.name ?? left.identity.login}</strong>
            <span className="note small">@{left.identity.login}</span>
          </span>
        </a>
        <Heading level={1} className="versus-word">
          versus
        </Heading>
        <a href={`/u/${right.identity.login}`} className="versus-side versus-right">
          <span>
            <strong>{right.identity.name ?? right.identity.login}</strong>
            <span className="note small">@{right.identity.login}</span>
          </span>
          <Face login={right.identity.login} name={right.identity.name ?? right.identity.login} size={64} />
        </a>
      </header>
      <Section fallback={<Skeleton height={8 * 49 + 90} />}>
        <Compare a={a} b={b} />
      </Section>
      <Swap a={a} b={b} />
    </div>
  );
}

function Compare({ a, b }: { a: string; b: string }) {
  const { origin } = Route.useLoaderData();
  const { data: v } = useSuspenseQuery(versusQuery(a, b));
  return (
    <>
      <Figure title="View by view" note="A winner for each view and none overall: each counts something different. — means not known for one of them.">
        <table className="versus-table">
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.view}>
                <td className={r.winner === "a" ? "versus-win" : undefined}>{shown(r, r.a)}</td>
                <th scope="row">
                  {r.label}
                  {r.winner === "tie" && <span className="note small"> · a tie</span>}
                </th>
                <td className={r.winner === "b" ? "versus-win versus-right-cell" : "versus-right-cell"}>{shown(r, r.b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Figure>
      <CardBox title="The Versus Card" about="Post it, or put it in a README." url={`${origin}/api/cards/vs/${v.a.identity.login}/${v.b.identity.login}/versus`} alt={`${v.a.identity.login} versus ${v.b.identity.login}`} link={`${origin}/vs/${v.a.identity.login}/${v.b.identity.login}`} share={`@${v.a.identity.login} versus @${v.b.identity.login}, view by view.`} width={640} height={170 + v.rows.filter((r) => r.a !== null || r.b !== null).length * 34} />
    </>
  );
}

function Swap({ a, b }: { a: string; b: string }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  return (
    <form
      className="work-filters"
      onSubmit={(e) => {
        e.preventDefault();
        const other = text.trim().replace(/^@/, "");
        if (isLogin(other)) void navigate({ to: "/vs/$a/$b", params: { a, b: other } });
      }}
    >
      <label className="work-field">
        <span>@{a} versus someone else</span>
        <input type="text" placeholder="a GitHub username" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <a className="card-link" href={`/vs/${b}/${a}`}>
        Swap sides
      </a>
    </form>
  );
}
