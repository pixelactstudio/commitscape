import { useState, type ReactNode } from "react";
import type { ISODateString } from "@astryxdesign/core/Calendar";
import { Button } from "@astryxdesign/core/Button";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Icon } from "@astryxdesign/core/Icon";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, CalendarRange, ChevronRight, Crown, Flag, Image as ImageIcon, LogIn, Repeat, UserPlus, Users } from "lucide-react";
import { monthName, raceState, seasonOf } from "@commitscape/data";
import { Face, Panel } from "@commitscape/ui";
import { answerInvitation, startCrew, startRace } from "#/functions/races";
import { signIn } from "#/lib/auth-client";
import { myRacesQuery } from "#/lib/queries";
import { useToast } from "#/lib/toast";
import { InviteField } from "#/components/Membership";
import { namesIn, shortRange, windowClock } from "#/lib/window";
import { StateBadge } from "#/components/WindowTable";

type Kind = "race" | "crew";

const WORD = { race: "Race", crew: "Crew" } as const;
const PATH = { race: "/races", crew: "/crews" } as const;

const DELAYS = ["", "[animation-delay:60ms]", "[animation-delay:120ms]"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (day: string, n: number) => iso(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));

const STEPS: Record<Kind, { icon: typeof Flag; title: string; words: string }[]> = {
  race: [
    { icon: CalendarRange, title: "Pick the days, invite people", words: "A week, a month, up to a year. Whoever you invite joins only when they accept." },
    { icon: Crown, title: "A leader for each view", words: "Pull requests merged, reviews, commits and contributions, from GitHub, read every 15 minutes. Never one score." },
    { icon: ImageIcon, title: "A finish Card", words: "When the last day ends, a Card with everyone's numbers, to post or put in a README." },
  ],
  crew: [
    { icon: UserPlus, title: "Invite your people", words: "Friends or a team. Each joins only when they accept, and can leave at any time." },
    { icon: Repeat, title: "A Season every month", words: "Standings start again on the first of each month, view by view, with a leader for each." },
    { icon: ImageIcon, title: "A recap Card", words: "When a Season ends, a Card of how it went, to post or keep." },
  ],
};

/** The signed-in person's Races or Crews, their invitations, and a form to start one; an invitation to sign in for everyone else. */
export function Start({ kind }: { kind: Kind }) {
  const { data: mine } = useSuspenseQuery(myRacesQuery());
  if (!mine) return <SignedOut kind={kind} />;
  const invitations = mine.invitations.filter((i) => i.kind === kind);
  return (
    <div className="flex flex-col gap-4">
      {invitations.length > 0 && <Invitations kind={kind} invitations={invitations} />}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        {kind === "race" ? <RaceList races={mine.races} /> : <CrewList crews={mine.crews} />}
        <div className="lg:sticky lg:top-20">
          <StartForm kind={kind} />
        </div>
      </div>
      <Other kind={kind} />
    </div>
  );
}

function SignedOut({ kind }: { kind: Kind }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        {STEPS[kind].map((s, n) => (
          <div key={s.title} className={`rise flex flex-col gap-3 rounded-[var(--radius-container)] border border-line bg-surface p-5 ${DELAYS[n] ?? ""}`}>
            <span className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-element)] bg-brand-soft text-brand">
                <s.icon size={16} aria-hidden />
              </span>
              <span className="text-xs font-medium text-secondary tnum">Step {n + 1}</span>
            </span>
            <span className="font-semibold">{s.title}</span>
            <span className="text-sm text-pretty text-secondary">{s.words}</span>
          </div>
        ))}
      </div>
      <div className="cta-backdrop flex flex-col items-start gap-4 rounded-[var(--radius-container)] border border-line p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-lg font-semibold tracking-[-0.01em]">Sign in to start a {WORD[kind]}, or to answer an invitation</span>
          <span className="text-sm text-secondary">With GitHub. Read-only, and you can stay out of every comparison in Settings.</span>
        </div>
        <Button label="Sign in with GitHub" variant="primary" icon={<Icon icon={LogIn} size="sm" />} onClick={() => signIn(PATH[kind])} />
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
    <section aria-label="Invitations" className="rise flex flex-col gap-3 rounded-[var(--radius-container)] border border-[color-mix(in_srgb,var(--brand)_35%,transparent)] bg-brand-soft p-4 sm:p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[1.02rem] font-semibold">{invitations.length === 1 ? "An invitation is waiting" : `${invitations.length} invitations are waiting`}</h2>
        <p className="m-0 text-sm text-secondary">You appear in a {WORD[kind]} only once you accept.</p>
      </div>
      {reply.error && <p className="m-0 text-sm text-removed">{reply.error.message}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {invitations.map((i) => (
          <li key={i.id} className="flex flex-col gap-3 rounded-[var(--radius-element)] bg-surface p-3 sm:flex-row sm:items-center">
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <Face login={i.invitedBy} name={i.invitedBy} size={32} />
              <span className="min-w-0 text-sm">
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
    <Panel padding={0} title="Your Races" description={races.length > 0 ? "Running first, then upcoming, then finished." : undefined}>
      {races.length === 0 ? (
        <Empty icon={Flag} title="No Races yet" words="Start one with the form: give it a name and its days, and invite the people you want to race." />
      ) : (
        <ul className="m-0 mt-1 flex list-none flex-col p-0">
          {sorted.map((r) => {
            const state = raceState(r.from, r.to);
            return (
              <Row key={r.id} to="/races/$id" id={r.id} title={r.name} sub={shortRange(r.from, r.to)} end={<span className="text-xs text-secondary">{windowClock(r.from, r.to).words}</span>} badge={<StateBadge state={state} />} />
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function order(r: { from: string; to: string }) {
  return { running: 0, upcoming: 1, finished: 2 }[raceState(r.from, r.to)];
}

function CrewList({ crews }: { crews: { id: string; name: string }[] }) {
  const season = seasonOf();
  return (
    <Panel padding={0} title="Your Crews" description={crews.length > 0 ? `This Season is ${monthName(season)}.` : undefined}>
      {crews.length === 0 ? (
        <Empty icon={Users} title="No Crews yet" words="Start one with the form and invite your people. Every month is a new Season." />
      ) : (
        <ul className="m-0 mt-1 flex list-none flex-col p-0">
          {crews.map((c) => (
            <Row key={c.id} to="/crews/$id" id={c.id} title={c.name} sub={`Season ${monthName(season)}`} end={<span className="text-xs text-secondary">{windowClock(`${season}-01`, lastDay(season)).words}</span>} />
          ))}
        </ul>
      )}
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
      <Link to={to} params={{ id }} className="group flex items-center gap-4 px-5 py-3.5 text-primary no-underline transition-colors hover:bg-[var(--color-overlay-hover)]">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2.5">
            <span className="truncate font-semibold">{title}</span>
            {badge}
          </span>
          <span className="text-sm text-secondary tnum">{sub}</span>
        </span>
        <span className="hidden flex-none sm:block">{end}</span>
        <ChevronRight size={16} className="flex-none text-secondary transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

function Empty({ icon: Glyph, title, words }: { icon: typeof Flag; title: string; words: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 pt-6 pb-10 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-soft text-brand">
        <Glyph size={18} aria-hidden />
      </span>
      <span className="font-medium">{title}</span>
      <span className="max-w-sm text-sm text-pretty text-secondary">{words}</span>
    </div>
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
                    className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition-colors ${on ? "border-transparent bg-brand-soft text-brand" : "border-line bg-transparent text-secondary hover:border-strong hover:text-primary"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <InviteField label="Invite, by GitHub username" description="Separate names with commas or spaces. They join only when they accept." value={invite} onChange={setInvite} />
        {start.error && <p className="m-0 text-sm text-removed">{start.error.message}</p>}
        <Button label={`Start the ${WORD[kind]}`} variant="primary" type="submit" isLoading={start.isPending} endContent={<Icon icon={ArrowRight} size="sm" />} width="100%" />
      </form>
    </Panel>
  );
}

function Other({ kind }: { kind: Kind }) {
  const other = kind === "race" ? { to: "/crews" as const, words: "Want something that never ends? A Crew compares itself every month.", cta: "Crews" } : { to: "/races" as const, words: "Want a fixed window instead? A Race runs between two days you choose.", cta: "Races" };
  return (
    <p className="m-0 pt-2 text-sm text-secondary">
      {other.words}{" "}
      <Link to={other.to} className="font-medium text-primary">
        {other.cta}
      </Link>
    </p>
  );
}
