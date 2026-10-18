import { useState, type ReactNode } from "react";
import type { ISODateString } from "@astryxdesign/core/Calendar";
import { Button } from "@astryxdesign/core/Button";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Icon } from "@astryxdesign/core/Icon";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ICON } from "@commitscape/ui/design";
import { ArrowRight, ChevronRight, LogIn } from "lucide-react";
import { monthName, raceState, seasonOf } from "@commitscape/data";
import { Face, Panel, Surface } from "@commitscape/ui";
import { answerInvitation, startCrew, startRace } from "#/functions/races";
import { signIn } from "#/lib/auth-client";
import { myRacesQuery } from "#/lib/queries";
import { useToast } from "#/lib/toast";
import { InviteField } from "#/components/Membership";
import { namesIn, shortRange, windowClock } from "#/lib/window";
import { StateBadge } from "#/components/Board";
import { CrewScene } from "#/home/scenes/CrewScene";
import { RaceScene } from "#/home/scenes/RaceScene";

type Kind = "race" | "crew";

const WORD = { race: "Race", crew: "Crew" } as const;
const PATH = { race: "/races", crew: "/crews" } as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (day: string, n: number) => iso(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));

const STEPS: Record<Kind, { title: string; words: string }[]> = {
  race: [
    { title: "Pick the days, invite people", words: "A week, a month, up to a year. Whoever you invite joins only when they accept." },
    { title: "A leader for each view", words: "Pull requests merged, reviews, commits and contributions, from GitHub, read every 15 minutes. Never one score." },
    { title: "A finish Card", words: "When the last day ends, a Card with everyone’s numbers, to post or put in a README." },
  ],
  crew: [
    { title: "Invite your people", words: "Friends or a team. Each joins only when they accept, and can leave at any time." },
    { title: "A Season every month", words: "Standings start again on the first of each month, view by view, with a leader for each." },
    { title: "A recap Card", words: "When a Season ends, a Card of how it went, to post or keep." },
  ],
};

function Steps({ kind }: { kind: Kind }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-4 p-0">
      {STEPS[kind].map((s, n) => (
        <li key={s.title} className="flex gap-3">
          <span aria-hidden className="grid size-7 flex-none place-items-center rounded-full bg-sunken type-caption font-semibold text-primary tnum">
            {n + 1}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="type-label">{s.title}</span>
            <span className="type-description">{s.words}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The signed-in person's Races or Crews, their invitations, and a form to start one; an invitation to sign in for everyone else. */
export function Start({ kind }: { kind: Kind }) {
  const { data: mine } = useSuspenseQuery(myRacesQuery());
  if (!mine) return <SignedOut kind={kind} />;
  const invitations = mine.invitations.filter((i) => i.kind === kind);
  const none = kind === "race" ? mine.races.length === 0 : mine.crews.length === 0;
  return (
    <div className="flex flex-col gap-gutter">
      {invitations.length > 0 && <Invitations kind={kind} invitations={invitations} />}
      <div className="grid items-start gap-gutter lg:grid-cols-[minmax(0,1fr)_26rem]">
        {none ? (
          <Panel title={`How a ${WORD[kind]} works`}>
            <Steps kind={kind} />
          </Panel>
        ) : kind === "race" ? (
          <RaceList races={mine.races} />
        ) : (
          <CrewList crews={mine.crews} />
        )}
        <div className="lg:sticky lg:top-(--chrome-top)">
          <StartForm kind={kind} />
        </div>
      </div>
      <Other kind={kind} />
    </div>
  );
}

function SignedOut({ kind }: { kind: Kind }) {
  return (
    <div className="flex flex-col gap-gutter">
      <div className="grid items-stretch gap-gutter lg:grid-cols-[minmax(0,1fr)_26rem]">
        <Surface padded className="flex flex-col gap-6">
          <h2 className="m-0 type-panel">How a {WORD[kind]} works</h2>
          <Steps kind={kind} />
          <div className="mt-auto flex flex-col gap-3 border-t border-separator pt-5 sm:flex-row sm:items-center sm:gap-4">
            <span className="flex-none">
              <Button label={`Sign in to start a ${WORD[kind]}`} variant="primary" icon={<Icon icon={LogIn} size="sm" />} onClick={() => signIn(PATH[kind])} />
            </span>
            <p className="m-0 type-caption text-pretty">Or to answer an invitation. With GitHub, read-only; you can stay out of every comparison in Settings.</p>
          </div>
        </Surface>
        <Surface className="flex flex-col overflow-hidden">
          <p className="m-0 px-panel pt-4 type-caption">An example {WORD[kind]}, with made-up people</p>
          <div aria-hidden className="min-h-72 flex-1 px-4 pb-4">
            {kind === "race" ? <RaceScene /> : <CrewScene />}
          </div>
        </Surface>
      </div>
      <Other kind={kind} />
    </div>
  );
}

function Invitations({ kind, invitations }: { kind: Kind; invitations: { id: string; name: string; invitedBy: string }[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const reply = useMutation({
    mutationFn: (x: { id: string; accept: boolean }) => answerInvitation({ data: { kind, ...x } }),
    onSuccess: (_, x) => {
      toast(x.accept ? `You are in it` : "Invitation declined");
      void queryClient.invalidateQueries();
    },
  });
  return (
    <section aria-label="Invitations" className="rise flex flex-col gap-3 rounded-lg border border-brand-line bg-brand-soft p-4 sm:p-panel">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 type-panel">{invitations.length === 1 ? "An invitation is waiting" : `${invitations.length} invitations are waiting`}</h2>
        <p className="m-0 type-description">You appear in a {WORD[kind]} only once you accept.</p>
      </div>
      {reply.error && (
        <p className="m-0 type-caption text-removed" role="alert">
          {reply.error.message}
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {invitations.map((i) => (
          <li key={i.id} className="flex flex-col gap-3 rounded-md bg-surface p-3 sm:flex-row sm:items-center">
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <Face login={i.invitedBy} name={i.invitedBy} size={32} />
              <span className="min-w-0 type-ui">
                @{i.invitedBy} invited you to{" "}
                <Link to={kind === "race" ? "/races/$id" : "/crews/$id"} params={{ id: i.id }} className="font-semibold text-primary">
                  {i.name}
                </Link>
              </span>
            </span>
            <span className="flex flex-none gap-2">
              <Button label="Decline" variant="secondary" size="sm" isDisabled={reply.isPending} onClick={() => reply.mutate({ id: i.id, accept: false })} />
              <Button label="Accept" variant="primary" size="sm" isDisabled={reply.isPending} onClick={() => reply.mutate({ id: i.id, accept: true })} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RaceList({ races }: { races: { id: string; name: string; from: string; to: string }[] }) {
  const sorted = [...races].sort((a, b) => order(a) - order(b) || (a.to < b.to ? 1 : -1));
  return (
    <Panel padding={0} title="Your Races" description="Running first, then upcoming, then finished.">
      <ul className="m-0 mt-1 flex list-none flex-col p-0">
        {sorted.map((r) => {
          const state = raceState(r.from, r.to);
          return <Row key={r.id} to="/races/$id" id={r.id} title={r.name} sub={shortRange(r.from, r.to)} end={windowClock(r.from, r.to).words} badge={<StateBadge state={state} />} />;
        })}
      </ul>
    </Panel>
  );
}

function order(r: { from: string; to: string }) {
  return { running: 0, upcoming: 1, finished: 2 }[raceState(r.from, r.to)];
}

function CrewList({ crews }: { crews: { id: string; name: string }[] }) {
  const season = seasonOf();
  return (
    <Panel padding={0} title="Your Crews" description={`This Season is ${monthName(season)}.`}>
      <ul className="m-0 mt-1 flex list-none flex-col p-0">
        {crews.map((c) => (
          <Row key={c.id} to="/crews/$id" id={c.id} title={c.name} sub={`Season ${monthName(season)}`} end={windowClock(`${season}-01`, lastDay(season)).words} />
        ))}
      </ul>
    </Panel>
  );
}

const lastDay = (season: string) => {
  const [y = 0, m = 1] = season.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m, 0)));
};

function Row({ to, id, title, sub, end, badge }: { to: "/races/$id" | "/crews/$id"; id: string; title: string; sub: string; end: ReactNode; badge?: ReactNode }) {
  return (
    <li className="border-t border-line">
      <Link to={to} params={{ id }} className="group row-hover flex items-center gap-4 px-5 py-3.5 text-primary no-underline">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2.5">
            <span className="type-ui font-semibold [overflow-wrap:anywhere]">{title}</span>
            {badge}
          </span>
          <span className="type-caption tnum">{sub}</span>
        </span>
        <span className="hidden flex-none type-caption sm:block">{end}</span>
        <ChevronRight size={ICON.md} className="flex-none text-tertiary transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

function StartForm({ kind }: { kind: Kind }) {
  const navigate = useNavigate();
  const today = iso(new Date());
  const [name, setName] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => plus(today, 6));
  const [invite, setInvite] = useState("");
  const start = useMutation({
    mutationFn: () => (kind === "race" ? startRace({ data: { name, from, to, invite: namesIn(invite) } }) : startCrew({ data: { name, invite: namesIn(invite) } })),
    onSuccess: ({ id }) => void navigate({ to: kind === "race" ? "/races/$id" : "/crews/$id", params: { id } }),
  });
  const lengths: [string, number][] = [
    ["A week", 7],
    ["Two weeks", 14],
    ["30 days", 30],
  ];
  return (
    <Panel title={`Start a ${WORD[kind]}`} description={kind === "race" ? "A fixed window between you and the people you invite." : "A group that compares itself every Season, a calendar month."}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          start.mutate();
        }}
      >
        <TextInput label="Name" value={name} placeholder={kind === "race" ? "The October sprint" : "The night shift"} onChange={setName} width="100%" />
        {kind === "race" && (
          <div className="flex flex-col gap-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <DateInput label="First day" value={from as ISODateString} onChange={(v) => v && setFrom(v)} format="date" width="100%" />
              </div>
              <div className="min-w-0">
                <DateInput label="Last day" value={to as ISODateString} min={from as ISODateString} onChange={(v) => v && setTo(v)} format="date" width="100%" />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Length">
              {lengths.map(([label, n]) => {
                const on = to === plus(from, n - 1);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTo(plus(from, n - 1))}
                    className={`plain-button hit h-7 rounded-full border px-3 type-caption font-medium transition-colors duration-(--duration-instant) ${on ? "border-brand-line bg-brand-soft text-brand" : "border-line text-secondary hover:border-line-strong hover:text-primary"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <InviteField label="Invite, by GitHub username" description="Separate names with commas or spaces. They join only when they accept." value={invite} onChange={setInvite} />
        {start.error && (
          <p className="m-0 type-caption text-removed" role="alert">
            {start.error.message}
          </p>
        )}
        <Button label={`Start the ${WORD[kind]}`} variant="primary" type="submit" isLoading={start.isPending} endContent={<Icon icon={ArrowRight} size="sm" />} width="100%" />
      </form>
    </Panel>
  );
}

function Other({ kind }: { kind: Kind }) {
  const other = kind === "race" ? { to: "/crews" as const, words: "Want something that never ends? A Crew compares itself every month.", cta: "Crews" } : { to: "/races" as const, words: "Want a fixed window instead? A Race runs between two days you choose.", cta: "Races" };
  return (
    <p className="m-0 pt-2 type-description">
      {other.words}{" "}
      <Link to={other.to} className="inline-link">
        {other.cta}
      </Link>
    </p>
  );
}
