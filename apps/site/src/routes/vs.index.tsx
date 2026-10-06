import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Typeahead } from "@astryxdesign/core/Typeahead";
import { createFileRoute, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ArrowRight, Swords } from "lucide-react";
import { isLogin, PRODUCT } from "@commitscape/data";
import { Face, Page } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { LookupRow, useLookupSource, type Item } from "#/lib/lookup";

export const Route = createFileRoute("/vs/")({
  head: () => ({ meta: [{ title: `Versus · ${PRODUCT}` }, { name: "description", content: "Put two developers side by side: a winner for each view, never one overall." }] }),
  component: Pick,
});

const MATCHES: [string, string][] = [
  ["gaearon", "acdlite"],
  ["torvalds", "gregkh"],
  ["sindresorhus", "tj"],
  ["yyx990803", "Rich-Harris"],
  ["BurntSushi", "dtolnay"],
  ["mitchellh", "kelseyhightower"],
];

function Person({ label, value, onChange, autoFocus = false }: { label: string; value: string; onChange: (login: string) => void; autoFocus?: boolean }) {
  const { user } = useRouteContext({ from: "__root__" });
  const source = useLookupSource(user?.login ?? null);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border border-line bg-surface p-panel">
      <div className="flex items-center gap-3">
        {isLogin(value) ? <Face login={value} name={value} size={48} /> : <span className="size-12 rounded-full border border-dashed border-line-strong" />}
        <div className="flex min-w-0 flex-col">
          <span className="type-caption font-medium">{label}</span>
          <span className="truncate type-panel">{isLogin(value) ? `@${value}` : "Someone"}</span>
        </div>
      </div>
      <Typeahead<Item>
        label={label}
        isLabelHidden
        placeholder="a GitHub username"
        searchSource={{ bootstrap: () => [], search: async (q) => (await source.search(q)).filter((i) => i.auxiliaryData?.to.startsWith("/u/")) }}
        value={null}
        hasAutoFocus={autoFocus}
        debounceMs={0}
        onChangeQuery={(q) => onChange(q.trim().replace(/^@/, ""))}
        onChange={(item) => {
          const to = item?.auxiliaryData?.to;
          if (to?.startsWith("/u/")) onChange(to.slice(3));
        }}
        renderItem={(item) => <LookupRow item={item} selected={false} />}
        width="100%"
      />
    </div>
  );
}

function Pick() {
  const navigate = useNavigate();
  const { user } = useRouteContext({ from: "__root__" });
  const [a, setA] = useState(user?.login ?? "");
  const [b, setB] = useState("");
  const ready = isLogin(a) && isLogin(b) && a.toLowerCase() !== b.toLowerCase();
  return (
    <Page width="narrow" className="flex flex-col gap-section pt-page-top pb-16">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <Swords size={ICON.lg} />
        </span>
        <h1 className="m-0 type-display">Versus</h1>
        <p className="m-0 max-w-lg type-lead">Put two developers side by side: pull requests, reviews, lines that still run, streaks and more. A winner for each view, never one overall.</p>
      </div>
      <form
        className="flex flex-col gap-gutter"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void navigate({ to: "/vs/$a/$b", params: { a, b } });
        }}
      >
        <div className="flex flex-col items-stretch gap-cluster sm:flex-row sm:items-center">
          <Person label="On the left" value={a} onChange={setA} autoFocus={!user} />
          <span className="vs-badge mx-auto grid size-11 flex-none place-items-center rounded-full text-xs font-bold">VS</span>
          <Person label="On the right" value={b} onChange={setB} autoFocus={!!user} />
        </div>
        <div className="flex justify-center">
          <Button label="Compare them" variant="primary" size="lg" type="submit" isDisabled={!ready} endContent={<Icon icon={ArrowRight} size="sm" />} />
        </div>
      </form>
      <section className="flex flex-col gap-3">
        <h2 className="m-0 type-eyebrow">Or start with one of these</h2>
        <ul className="m-0 grid list-none gap-cluster p-0 sm:grid-cols-2">
          {MATCHES.map(([x, y]) => (
            <li key={`${x}${y}`}>
              <Link to="/vs/$a/$b" params={{ a: x, b: y }} className="group flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-primary no-underline transition-colors hover:border-line-strong">
                <span className="flex -space-x-2">
                  <span className="rounded-full ring-2 ring-surface">
                    <Face login={x} name={x} size={32} />
                  </span>
                  <span className="rounded-full ring-2 ring-surface">
                    <Face login={y} name={y} size={32} />
                  </span>
                </span>
                <span className="min-w-0 flex-1 truncate type-label">
                  {x} <span className="text-secondary">vs</span> {y}
                </span>
                <ArrowRight size={ICON.sm} className="text-secondary transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
