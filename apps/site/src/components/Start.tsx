import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Figure } from "@commitscape/ui";
import { answerInvitation, startCrew, startRace } from "#/functions/races";
import { signIn } from "#/lib/auth-client";
import { myRacesQuery } from "#/lib/queries";

/** The signed-in person's Races or Crews, their invitations, and a form to start one. */
export function Start({ kind }: { kind: "race" | "crew" }) {
  const navigate = useNavigate();
  const { data: mine, refetch } = useSuspenseQuery(myRacesQuery());
  const [name, setName] = useState("");
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10));
  const [invite, setInvite] = useState("");
  const start = useMutation({
    mutationFn: () => {
      const people = invite.split(/[\s,]+/).filter(Boolean);
      return kind === "race" ? startRace({ data: { name, from, to, invite: people } }) : startCrew({ data: { name, invite: people } });
    },
    onSuccess: ({ id }) => void navigate({ to: kind === "race" ? "/races/$id" : "/crews/$id", params: { id } }),
  });
  const reply = useMutation({ mutationFn: (x: { kind: "race" | "crew"; id: string; accept: boolean }) => answerInvitation({ data: x }), onSuccess: () => void refetch() });
  const word = kind === "race" ? "Race" : "Crew";
  if (!mine) {
    return (
      <Figure title={`Start a ${word}`} note="Sign in with GitHub to start one or accept an invitation.">
        <Button label="Sign in with GitHub" variant="primary" onClick={() => signIn(kind === "race" ? "/races" : "/crews")} />
      </Figure>
    );
  }
  const list: { id: string; name: string; from?: string; to?: string }[] = kind === "race" ? mine.races : mine.crews;
  const invitations = mine.invitations.filter((i) => i.kind === kind);
  return (
    <>
      {invitations.length > 0 && (
        <Figure title="Invitations" note="You appear only once you accept.">
          {invitations.map((i) => (
            <div key={i.id} className="invitation">
              <span>
                @{i.invitedBy} invited you to <a href={`/${kind === "race" ? "races" : "crews"}/${i.id}`}>{i.name}</a>
              </span>
              <Button label="Accept" variant="primary" size="sm" onClick={() => reply.mutate({ kind, id: i.id, accept: true })} />
              <Button label="Decline" variant="ghost" size="sm" onClick={() => reply.mutate({ kind, id: i.id, accept: false })} />
            </div>
          ))}
        </Figure>
      )}
      <Figure title={`Your ${word}s`}>
        {list.length === 0 ? <p className="note">None yet.</p> : (
          <ul className="facts">
            {list.map((x) => (
              <li key={x.id}>
                <a href={`/${kind === "race" ? "races" : "crews"}/${x.id}`}>{x.name}</a>
                {x.from && <span className="note small"> {x.from} to {x.to}</span>}
              </li>
            ))}
          </ul>
        )}
      </Figure>
      <Figure title={`Start a ${word}`} note={kind === "race" ? "A fixed window; the people you invite join only when they accept." : "A group that compares itself every Season; the people you invite join only when they accept."}>
        <form
          className="create-form"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          {start.error && <Banner status="error" title={start.error.message} />}
          <div className="work-filters">
            <label className="work-field">
              <span>Name</span>
              <input type="text" value={name} placeholder={kind === "race" ? "The October sprint" : "The night shift"} onChange={(e) => setName(e.target.value)} />
            </label>
            {kind === "race" && (
              <>
                <label className="work-field">
                  <span>First day</span>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="work-field">
                  <span>Last day</span>
                  <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
                </label>
              </>
            )}
            <label className="work-field">
              <span>Invite, by GitHub username</span>
              <input type="text" value={invite} placeholder="alice, bob" onChange={(e) => setInvite(e.target.value)} />
            </label>
            <Button label={`Start the ${word}`} variant="primary" type="submit" isDisabled={start.isPending} />
          </div>
        </form>
      </Figure>
    </>
  );
}

export function StartHeading({ kind }: { kind: "race" | "crew" }) {
  return (
    <header className="repo-head">
      <div className="min-w-0 flex-1">
        <Heading level={1} className="repo-title">
          {kind === "race" ? "Races" : "Crews"}
        </Heading>
        <p className="repo-facts note small">
          <span>{kind === "race" ? "Two or more people, a fixed window, live Standings view by view, and a finish Card." : "Friends or a team who compare themselves each Season, a calendar month, with a recap Card when it ends."}</span>
        </p>
      </div>
    </header>
  );
}
