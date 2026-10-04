import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { PRODUCT, workSentence } from "@commitscape/data";
import { WorkView } from "@commitscape/ui";
import { deleteSharedWork } from "#/functions/work";
import { sharedWorkQuery } from "#/lib/queries";

export const Route = createFileRoute("/u/$login_/work_/$id")({
  loader: ({ params, context }) => context.queryClient.ensureQueryData(sharedWorkQuery(params.id)),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.name ?? loaderData.login}'s Proof of Work, ${loaderData.from} to ${loaderData.to} · ${PRODUCT}` : PRODUCT }, { name: "robots", content: "noindex" }] }),
  component: SharedProof,
});

function SharedProof() {
  const { id } = Route.useParams();
  const { data: work } = useSuspenseQuery(sharedWorkQuery(id));
  const { user } = useRouteContext({ from: "__root__" });
  const remove = useMutation({ mutationFn: () => deleteSharedWork({ data: { id } }) });
  const mine = user?.login.toLowerCase() === work.login.toLowerCase();
  if (remove.isSuccess) return <Banner status="success" title="Deleted: this link no longer opens anything." />;
  return (
    <div className="flex flex-col gap-5 pb-8">
      <header className="repo-head">
        <div className="min-w-0 flex-1">
          <Heading level={1} className="repo-title">
            <a href={`/u/${work.login}`}>{work.name ?? work.login}</a>'s Proof of Work
          </Heading>
          <p className="repo-facts note small">
            <span>
              {work.from} to {work.to}
              {work.filter ? `, in ${work.filter}` : ""}. Shared as it was on {new Date(work.at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.
            </span>
          </p>
        </div>
      </header>
      <div className="work-actions">
        <p className="note">{workSentence(work.items)}</p>
        <div className="actions">
          <a className="card-link" href={`/api/work/s/${id}/proof.md`} download>
            Markdown
          </a>
          <a className="card-link" href={`/api/work/s/${id}/proof.pdf`} download>
            PDF
          </a>
          {mine && <Button label="Delete this link" variant="destructive" size="sm" isDisabled={remove.isPending} onClick={() => remove.mutate()} />}
        </div>
      </div>
      {remove.error && <Banner status="error" title={remove.error.message} />}
      <WorkView work={work} />
    </div>
  );
}
