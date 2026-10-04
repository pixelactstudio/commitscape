import { useEffect, useState, type ReactNode } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRound, Lock, Timer, Trash2 } from "lucide-react";
import { deleteToken, readReport, reportSource, unlock, type DataSource } from "@commitscape/data";
import { App, Page, PageHead, ScreenSkeleton, SourceContext, toRoute, toSearch, type Route as Where } from "@commitscape/ui";
import { Chip } from "#/components/Facts";
import { shareKey } from "#/share-key";

export const Route = createFileRoute("/s/$id")({
  validateSearch: (search: Record<string, unknown>) => toSearch(search),
  head: () => ({ meta: [{ title: "A Shared Report · commitscape" }, { name: "robots", content: "noindex" }] }),
  component: SharedReport,
});

type State = { kind: "opening" } | { kind: "open"; source: DataSource; expiresAt: number } | { kind: "deleted" } | { kind: "error"; words: string };

function left(expiresAt: number): string {
  const s = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const ABOUT = "Locked on the machine that made it, with a key only its link holds: the Site stores what it cannot read.";

function Head({ title, chips, actions }: { title: ReactNode; chips?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="border-b border-line">
      <Page>
        <PageHead
          eyebrow={
            <span className="inline-flex items-center gap-1.5">
              <KeyRound size={14} aria-hidden /> A Shared Report
            </span>
          }
          title={title}
          description={
            <span className="flex flex-col gap-3">
              <span>{ABOUT}</span>
              {chips && <span className="flex flex-wrap gap-1.5">{chips}</span>}
            </span>
          }
          actions={actions}
          media={<span className="grid size-[4.5rem] flex-none place-items-center rounded-[20px] bg-brand-soft text-brand"><Lock size={28} aria-hidden /></span>}
        />
      </Page>
    </section>
  );
}

/** A Shared Report: unlocked in the browser with the key in the link's fragment, then every screen of it. */
function SharedReport() {
  const { id } = Route.useParams();
  const where = toRoute(Route.useSearch());
  const navigate = useNavigate({ from: Route.fullPath });
  const go = (change: Partial<Where>, replace = false) => void navigate({ search: (prev) => toSearch({ ...prev, ...change }), replace, resetScroll: false });
  const [state, setState] = useState<State>({ kind: "opening" });
  const [deleting, setDeleting] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const key = shareKey();
    let current = true;
    const set = (s: State) => current && setState(s);
    if (!key) {
      set({ kind: "error", words: "This link has lost its key: the part after # is missing or cut short. Ask for the whole link." });
      return;
    }
    (async () => {
      const answer = await fetch(`/api/shares/${encodeURIComponent(id)}`);
      if (answer.status === 410) return set({ kind: "error", words: "This Shared Report has expired. Ask for a new link." });
      if (!answer.ok) return set({ kind: "error", words: "There is no Shared Report here: it was deleted, or never made." });
      const expiresAt = Number(answer.headers.get("x-expires-at") ?? 0);
      let plain: Uint8Array;
      try {
        plain = await unlock(key, new Uint8Array(await answer.arrayBuffer()));
      } catch {
        return set({ kind: "error", words: "This Shared Report could not be unlocked: the link's key is not its key, or what is stored was changed." });
      }
      set({ kind: "open", source: reportSource(await readReport(plain), `share:${id}`), expiresAt });
    })().catch((e: Error) => set({ kind: "error", words: e.message }));
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [id]);

  const remove = async () => {
    const key = shareKey();
    if (!key) return;
    setDeleting("Deleting…");
    const answer = await fetch(`/api/shares/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-delete-token": await deleteToken(key) } });
    if (answer.ok) setState({ kind: "deleted" });
    else setDeleting(((await answer.json()) as { error?: string }).error ?? "It could not be deleted.");
  };

  if (state.kind === "open") {
    return (
      <SourceContext value={state.source}>
        <Head
          title={state.source.meta.name}
          chips={
            <>
              <Chip icon={<Lock size={13} aria-hidden />}>read in this browser only</Chip>
              <Chip icon={<Timer size={13} aria-hidden />} tone="brand">
                shared · expires in {left(state.expiresAt)}
              </Chip>
            </>
          }
          actions={<Button label={deleting ?? "Delete"} variant="destructive" icon={<Icon icon={Trash2} size="sm" />} onClick={() => void remove()} isDisabled={deleting === "Deleting…"} tooltip="Take it down now, for everyone with the link" />}
        />
        <Page className="pb-6">
          <App route={where} go={go} />
        </Page>
      </SourceContext>
    );
  }
  return (
    <>
      <Head title={state.kind === "opening" ? <Skeleton height={36} width={260} radius={2} /> : "A Shared Report"} chips={state.kind === "opening" ? <Chip icon={<KeyRound size={13} aria-hidden />}>unlocking it in this browser…</Chip> : undefined} />
      <Page className="flex flex-col gap-4 pt-6 pb-16">
        {state.kind === "opening" && (
          <div aria-busy="true" aria-label="Unlocking">
            <div className="-mx-4 flex h-[37px] items-center gap-6 border-b border-line px-4 sm:-mx-6 sm:px-6">
              {[64, 52, 58, 36, 64].map((w, i) => (
                <Skeleton key={i} height={14} width={w} radius={1} index={i} />
              ))}
            </div>
            <ScreenSkeleton />
          </div>
        )}
        {state.kind === "deleted" && <Banner status="success" title="Deleted: this link no longer opens anything." />}
        {state.kind === "error" && <Banner status="warning" title={state.words} />}
      </Page>
    </>
  );
}
