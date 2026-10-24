import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Typeahead } from "@astryxdesign/core/Typeahead";
import { createFileRoute, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { isLogin, PRODUCT } from "@commitscape/data";
import { Face, FaceStack, Page, PageHead, TONE, type Side } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { mayTakeFocus } from "#/lib/hydrated";
import { LookupRow, useLookupSource, type Item } from "#/lib/lookup";

export const Route = createFileRoute("/vs/")({
  head: () => ({ meta: [{ title: `Versus · ${PRODUCT}` }, { name: "description", content: "Put two developers side by side: a winner for each view, never one overall." }] }),
  component: Pick,
});

const MATCHES: [string, string, string][] = [
  ["gaearon", "acdlite", "Two people behind React"],
  ["torvalds", "gregkh", "The Linux kernel and its stable branches"],
  ["sindresorhus", "tj", "Two prolific authors of npm packages"],
  ["yyx990803", "Rich-Harris", "Vue and Svelte"],
  ["BurntSushi", "dtolnay", "Rust crates in everyone’s lockfile"],
  ["mitchellh", "kelseyhightower", "Infrastructure tools"],
];

const WORDS: Record<Side, string> = { a: "Left", b: "Right" };

function Slot({ side, value, onChange, autoFocus = false }: { side: Side; value: string; onChange: (login: string) => void; autoFocus?: boolean }) {
  const { user } = useRouteContext({ from: "__root__" });
  const source = useLookupSource(user?.login ?? null);
  const known = isLogin(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus && mayTakeFocus()) input.current?.focus();
  }, [autoFocus]);
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-sunken p-4" style={{ borderTopColor: TONE[side], borderTopWidth: 2 }}>
      <div className="flex items-center gap-3">
        {known ? <Face login={value} name={value} size={48} /> : <span aria-hidden className="size-12 flex-none rounded-full border border-dashed border-strong" />}
        <div className="flex min-w-0 flex-col">
          <span className="type-eyebrow">{WORDS[side]}</span>
          <span className={`truncate type-heading ${known ? "" : "text-tertiary"}`}>{known ? `@${value}` : "Choose someone"}</span>
        </div>
      </div>
      <Typeahead<Item>
        label={`${WORDS[side]} person, a GitHub username`}
        isLabelHidden
        placeholder="a GitHub username"
        searchSource={{ bootstrap: () => [], search: async (q) => (await source.search(q)).filter((i) => i.auxiliaryData?.to.startsWith("/u/")) }}
        value={null}
        ref={input}
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
  const same = isLogin(a) && isLogin(b) && a.toLowerCase() === b.toLowerCase();
  const ready = isLogin(a) && isLogin(b) && !same;
  return (
    <Page className="flex flex-col gap-section pb-section">
      <div>
        <PageHead title="Versus" description="Put two developers side by side: pull requests, reviews, lines that still run, streaks and more. A winner for each view, never one overall." />
        <form
          className="surface flex flex-col gap-5 p-panel"
          aria-label="Choose two people"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) void navigate({ to: "/vs/$a/$b", params: { a, b } });
          }}
        >
          <div className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <Slot side="a" value={a} onChange={setA} autoFocus={!user} />
            <span aria-hidden className="vs-badge mx-auto grid size-11 flex-none place-items-center rounded-full text-sm font-bold">
              VS
            </span>
            <Slot side="b" value={b} onChange={setB} autoFocus={!!user} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-separator pt-4">
            <p className="m-0 type-caption" role="status">
              {same ? "Choose two different people." : "Each view counts something different, so no one wins overall."}
            </p>
            <Button label="Compare them" variant="primary" size="lg" type="submit" isDisabled={!ready} endContent={<Icon icon={ArrowRight} size="sm" />} />
          </div>
        </form>
      </div>
      <section aria-labelledby="matches" className="flex flex-col gap-stack">
        <h2 id="matches" className="m-0 type-heading">
          Or start with one of these
        </h2>
        <ul className="m-0 grid list-none grid-cols-1 gap-cluster p-0 sm:grid-cols-2 lg:grid-cols-3">
          {MATCHES.map(([x, y, why]) => (
            <li key={`${x}${y}`}>
              <Link to="/vs/$a/$b" params={{ a: x, b: y }} className="group surface row-hover flex h-full items-center gap-3 p-3 text-primary no-underline">
                <FaceStack people={[{ login: x }, { login: y }]} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="type-label [overflow-wrap:anywhere]">
                    {x} <span className="font-normal text-secondary">vs</span> {y}
                  </span>
                  <span className="type-caption [overflow-wrap:anywhere]">{why}</span>
                </span>
                <ArrowRight size={ICON.sm} className="flex-none text-tertiary transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
