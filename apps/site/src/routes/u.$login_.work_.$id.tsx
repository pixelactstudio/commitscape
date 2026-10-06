import { useState } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouteContext, type ErrorComponentProps } from "@tanstack/react-router";
import { ArrowLeft, Download, Link2, Trash2 } from "lucide-react";
import { PRODUCT } from "@commitscape/data";
import { Face, Page, PageHead, periodWords, WorkView } from "@commitscape/ui";
import { Missing } from "#/components/Missing";
import { PageError } from "#/components/States";
import { deleteSharedWork } from "#/functions/work";
import { sharedWorkQuery } from "#/lib/queries";
import { useToast } from "#/lib/toast";

export const Route = createFileRoute("/u/$login_/work_/$id")({
  loader: async ({ params, context }) => ({ work: await context.queryClient.ensureQueryData(sharedWorkQuery(params.id)), origin: context.origin ?? "" }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.work.name ?? loaderData.work.login}'s Proof of Work, ${loaderData.work.from} to ${loaderData.work.to} · ${PRODUCT}` : PRODUCT }, { name: "robots", content: "noindex" }] }),
  errorComponent: Gone,
  component: SharedProof,
});

function Gone(props: ErrorComponentProps) {
  const { login } = Route.useParams();
  if (props.error instanceof Error && props.error.message.startsWith("There is no shared Proof of Work")) return <Missing title="This link opens nothing" words="Its Proof of Work was deleted by the person who shared it, or never made." back={{ label: `@${login}'s Profile`, href: `/u/${login}` }} />;
  return <PageError {...props} />;
}

const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function SharedProof() {
  const { id } = Route.useParams();
  const { origin } = Route.useLoaderData();
  const { data: work } = useSuspenseQuery(sharedWorkQuery(id));
  const { user } = useRouteContext({ from: "__root__" });
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const remove = useMutation({ mutationFn: () => deleteSharedWork({ data: { id } }) });
  const mine = user?.login.toLowerCase() === work.login.toLowerCase();
  const name = work.name ?? work.login;
  if (remove.isSuccess) return <Missing title="Deleted" words="This link no longer opens anything. Anyone who had it sees that it is gone." back={{ label: "Your Proof of Work", href: `/u/${work.login}/work` }} />;
  return (
    <Page className="flex flex-col gap-gutter pb-16">
      <PageHead
        media={<Face login={work.login} name={name} size={48} />}
        eyebrow={
          <Link to="/u/$login" params={{ login: work.login }} className="inline-flex items-center gap-1 text-secondary no-underline hover:text-primary">
            <ArrowLeft size={14} aria-hidden /> {name}
          </Link>
        }
        title={`${name}'s Proof of Work`}
        description={
          <>
            <span className="font-medium text-primary">{periodWords(work.from, work.to)}</span>
            {work.filter ? `, only in ${work.filter}` : ", everywhere on GitHub"}. Shared as it was on {LONG.format(new Date(work.at * 1000))}: it does not change.
          </>
        }
        actions={
          <>
            <Button label="Copy link" variant="secondary" icon={<Icon icon={Link2} size="sm" />} onClick={() => void navigator.clipboard?.writeText(`${origin}/u/${work.login}/work/${id}`).then(() => toast("Link copied"))} />
            <Button label="Markdown" variant="secondary" icon={<Icon icon={Download} size="sm" />} href={`/api/work/s/${id}/proof.md`} tooltip="Download as Markdown" />
            <Button label="PDF" variant="secondary" icon={<Icon icon={Download} size="sm" />} href={`/api/work/s/${id}/proof.pdf`} tooltip="Download as PDF" />
            {mine && <Button label="Delete this link" variant="destructive" icon={<Icon icon={Trash2} size="sm" />} onClick={() => setAsking(true)} />}
          </>
        }
      />
      <WorkView work={work} footer={`Read from GitHub and kept on ${LONG.format(new Date(work.at * 1000))}. Made with ${PRODUCT}.`} />
      {mine && (
        <AlertDialog
          isOpen={asking}
          onOpenChange={setAsking}
          title="Delete this link?"
          description={remove.error ? remove.error.message : "Anyone who opens it afterwards sees that it is gone. Your Proof of Work itself stays; you can share it again."}
          actionLabel="Delete the link"
          isActionLoading={remove.isPending}
          onAction={() => remove.mutate()}
        />
      )}
    </Page>
  );
}
