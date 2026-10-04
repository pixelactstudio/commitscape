import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Member } from "@commitscape/data";
import { Face } from "@commitscape/ui";
import { answerInvitation, inviteMore, leaveIt } from "#/functions/races";

/** The people in a Race or a Crew, and what the viewer can do: accept or decline their invitation, invite others, or leave. */
export function Membership({ kind, id, members, you, signedIn }: { kind: "race" | "crew"; id: string; members: Member[]; you: Member | null; signedIn: boolean }) {
  const queryClient = useQueryClient();
  const [names, setNames] = useState("");
  const refresh = () => queryClient.invalidateQueries();
  const reply = useMutation({ mutationFn: (accept: boolean) => answerInvitation({ data: { kind, id, accept } }), onSuccess: refresh });
  const out = useMutation({ mutationFn: () => leaveIt({ data: { kind, id } }), onSuccess: refresh });
  const add = useMutation({
    mutationFn: () => inviteMore({ data: { kind, id, invite: names.split(/[\s,]+/).filter(Boolean) } }),
    onSuccess: () => {
      setNames("");
      void refresh();
    },
  });
  const word = kind === "race" ? "Race" : "Crew";
  const error = reply.error ?? out.error ?? add.error;
  return (
    <section className="flex flex-col gap-3">
      {error && <Banner status="error" title={error.message} />}
      {you?.state === "invited" && (
        <div className="invitation">
          <span>
            @{you.invitedBy} invited you to this {word}. You appear in it only once you accept.
          </span>
          <Button label="Accept" variant="primary" size="sm" isDisabled={reply.isPending} onClick={() => reply.mutate(true)} />
          <Button label="Decline" variant="ghost" size="sm" isDisabled={reply.isPending} onClick={() => reply.mutate(false)} />
        </div>
      )}
      <ul className="members">
        {members.map((m) => (
          <li key={m.login}>
            <Face login={m.login} name={m.login} size={24} />
            <a href={`/u/${m.login}`}>@{m.login}</a>
            {m.state === "invited" && <span className="note small">invited by @{m.invitedBy}</span>}
          </li>
        ))}
      </ul>
      {you?.state === "accepted" && (
        <form
          className="work-filters"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <label className="work-field">
            <span>Invite people by GitHub username</span>
            <input type="text" value={names} placeholder="alice, bob" onChange={(e) => setNames(e.target.value)} />
          </label>
          <Button label="Invite" variant="secondary" type="submit" isDisabled={add.isPending || !names.trim()} />
          <Button label={`Leave this ${word}`} variant="destructive" size="sm" isDisabled={out.isPending} onClick={() => out.mutate()} />
        </form>
      )}
      {!signedIn && <p className="note small">Invited? Sign in with GitHub to accept.</p>}
    </section>
  );
}
