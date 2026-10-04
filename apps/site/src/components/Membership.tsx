import { useState } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LogOut, Mail, UserPlus } from "lucide-react";
import { isLogin, type Member } from "@commitscape/data";
import { Face, Panel } from "@commitscape/ui";
import { namesIn } from "#/lib/window";
import { answerInvitation, inviteMore, leaveIt } from "#/functions/races";
import { signIn } from "#/lib/auth-client";
import { useToast } from "#/lib/toast";

type Kind = "race" | "crew";

const WORD = { race: "Race", crew: "Crew" } as const;

/** A field for GitHub usernames, with each name shown as a face as it is typed. */
export function InviteField({ label, value, onChange, description }: { label: string; value: string; onChange: (v: string) => void; description?: string }) {
  const names = namesIn(value);
  return (
    <div className="flex flex-col gap-2">
      <TextInput label={label} description={description} value={value} placeholder="alice, bob" onChange={onChange} width="100%" autoComplete="off" />
      {names.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="People to invite">
          {names.map((n) => {
            const ok = isLogin(n);
            return (
              <li key={n} className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 ps-0.5 pe-2.5 text-xs ${ok ? "border-line bg-surface" : "border-[var(--color-border-error,var(--removed))] text-removed"}`}>
                {ok ? <Face login={n} name={n} size={20} /> : <span className="w-1" />}
                {ok ? `@${n}` : `${n} is not a GitHub username`}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The viewer's invitation to a Race or a Crew, with Accept and Decline, when there is one. */
export function InvitationCallout({ kind, id, you }: { kind: Kind; id: string; you: Member | null }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const reply = useMutation({
    mutationFn: (accept: boolean) => answerInvitation({ data: { kind, id, accept } }),
    onSuccess: (_, accept) => {
      toast(accept ? `You are in this ${WORD[kind]}` : "Invitation declined");
      void queryClient.invalidateQueries();
    },
  });
  if (you?.state !== "invited") return null;
  return (
    <div role="region" aria-label="Your invitation" className="rise flex flex-col gap-4 rounded-[var(--radius-container)] border border-[color-mix(in_srgb,var(--brand)_35%,transparent)] bg-brand-soft p-4 sm:flex-row sm:items-center sm:p-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Face login={you.invitedBy} name={you.invitedBy} size={40} />
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold">@{you.invitedBy} invited you to this {WORD[kind]}</span>
          <span className="text-sm text-secondary">You appear in it only once you accept, and you can leave at any time.</span>
          {reply.error && <span className="text-sm text-removed">{reply.error.message}</span>}
        </div>
      </div>
      <div className="flex flex-none gap-2">
        <Button label="Decline" variant="secondary" isDisabled={reply.isPending} onClick={() => reply.mutate(false)} />
        <Button label="Accept" variant="primary" isLoading={reply.isPending && reply.variables} isDisabled={reply.isPending} onClick={() => reply.mutate(true)} />
      </div>
    </div>
  );
}

/** The people in a Race or a Crew, and what the viewer can do there: invite others, or leave. */
export function People({ kind, id, members, you, signedIn, createdBy }: { kind: Kind; id: string; members: Member[]; you: Member | null; signedIn: boolean; createdBy: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [names, setNames] = useState("");
  const [leaving, setLeaving] = useState(false);
  const refresh = () => queryClient.invalidateQueries();
  const out = useMutation({
    mutationFn: () => leaveIt({ data: { kind, id } }),
    onSuccess: () => {
      setLeaving(false);
      toast(`You left this ${WORD[kind]}`);
      void refresh();
    },
  });
  const add = useMutation({
    mutationFn: () => inviteMore({ data: { kind, id, invite: namesIn(names) } }),
    onSuccess: () => {
      toast(namesIn(names).length === 1 ? "Invitation sent" : "Invitations sent");
      setNames("");
      void refresh();
    },
  });
  const accepted = members.filter((m) => m.state === "accepted");
  const invited = members.filter((m) => m.state === "invited");
  const inIt = you?.state === "accepted";
  return (
    <Panel
      title="People"
      description={`${accepted.length} in it${invited.length > 0 ? `, ${invited.length} invited` : ""}. People join only when they accept.`}
      actions={inIt ? <Button label={`Leave this ${WORD[kind]}`} variant="ghost" size="sm" icon={<Icon icon={LogOut} size="sm" />} onClick={() => setLeaving(true)} /> : undefined}
    >
      <ul className="m-0 flex list-none flex-col p-0" aria-label={`People in this ${WORD[kind]}`}>
        {members.map((m) => (
          <li key={m.login} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0">
            <Face login={m.login} name={m.login} size={32} />
            <Link to="/u/$login" params={{ login: m.login }} className="min-w-0 truncate text-sm font-medium text-primary no-underline hover:underline">
              @{m.login}
            </Link>
            {m.login === createdBy && <span className="text-xs text-secondary">started it</span>}
            {you && m.login === you.login && <Badge label="you" variant="neutral" />}
            {m.state === "invited" && (
              <span className="ms-auto inline-flex items-center gap-1.5 text-xs text-secondary">
                <Mail size={12} aria-hidden /> invited by @{m.invitedBy}
              </span>
            )}
          </li>
        ))}
      </ul>
      {inIt && (
        <form
          className="flex flex-col gap-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (namesIn(names).length > 0) add.mutate();
          }}
        >
          <InviteField label="Invite people by GitHub username" value={names} onChange={setNames} />
          {add.error && <p className="m-0 text-sm text-removed">{add.error.message}</p>}
          <div>
            <Button label="Invite" variant="secondary" type="submit" icon={<Icon icon={UserPlus} size="sm" />} isLoading={add.isPending} isDisabled={namesIn(names).length === 0} />
          </div>
        </form>
      )}
      {!signedIn && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-sm text-secondary">Invited? Sign in with GitHub to answer.</span>
          <Button label="Sign in with GitHub" variant="secondary" size="sm" onClick={() => signIn(`/${kind === "race" ? "races" : "crews"}/${id}`)} />
        </div>
      )}
      <AlertDialog
        isOpen={leaving}
        onOpenChange={setLeaving}
        title={`Leave this ${WORD[kind]}?`}
        description={out.error ? out.error.message : `You are taken out of its Standings at once. To come back, someone in it has to invite you again.`}
        actionLabel={`Leave the ${WORD[kind]}`}
        isActionLoading={out.isPending}
        onAction={() => out.mutate()}
      />
    </Panel>
  );
}
