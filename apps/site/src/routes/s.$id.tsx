import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRound, Lock, Timer, Trash2 } from "lucide-react";
import { ICON } from "@commitscape/ui/design";
import { deleteToken, readReport, reportSource, unlock, type DataSource } from "@commitscape/data";
import { App, Pill, queryOf, SCREEN_SKELETONS, ScreenColumn, ScreenHeader, screensOf, searcher, SourceContext, TITLES, toRoute, toSearch, Workspace, type Route as Where, type WorkspaceSlots } from "@commitscape/ui";
import { Notice } from "#/components/Notice";
import { shareKey } from "#/share-key";

export const Route = createFileRoute("/s/$id")({
  staticData: { frame: "workspace" },
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

function Identity({ name, expires }: { name: ReactNode; expires?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 px-2 pt-1">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 flex-none place-items-center rounded-md bg-brand-soft text-brand">
          <Lock size={ICON.md} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="type-caption">A Shared Report</span>
          <span className="truncate type-body font-semibold">{name}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 type-micro">
        <span className="inline-flex items-center gap-1">
          <Lock size={ICON.xs} aria-hidden /> read in this browser only
        </span>
        {expires && (
          <span className="inline-flex items-center gap-1 text-brand">
            <Timer size={ICON.xs} aria-hidden /> expires in {expires}
          </span>
        )}
      </div>
    </div>
  );
}

function Hero({ name, expires }: { name: string; expires: string }) {
  return (
    <section aria-labelledby="shared-title" className="border-b border-separator">
      <div className="mx-auto flex w-full max-w-(--content) flex-col gap-4 px-(--main-pad) pt-8 pb-6 sm:flex-row sm:items-center sm:gap-5">
        <span aria-hidden className="grid size-14 flex-none place-items-center rounded-xl border border-brand-line bg-brand-soft text-brand shadow-float sm:size-18">
          <KeyRound size={ICON.lg} />
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <span className="type-caption font-medium text-secondary">A Shared Report</span>
          <h1 id="shared-title" className="m-0 type-display type-id break-words">
            {name}
          </h1>
          <p className="m-0 max-w-2xl type-body text-pretty">{ABOUT}</p>
          <div className="mt-1 flex flex-wrap gap-1.5 lg:hidden">
            <Pill icon={<Lock size={ICON.xs} aria-hidden />}>read in this browser only</Pill>
            <Pill icon={<Timer size={ICON.xs} aria-hidden />} tone="brand">
              shared · expires in {expires}
            </Pill>
          </div>
        </div>
      </div>
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
        return set({ kind: "error", words: "This Shared Report could not be unlocked: the link’s key is not its key, or what is stored was changed." });
      }
      set({ kind: "open", source: reportSource(await readReport(plain), `share:${id}`, searcher), expiresAt });
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

  const Opening = SCREEN_SKELETONS[where.screen];
  const link = (r: Where) => `/s/${encodeURIComponent(id)}${queryOf(r)}${typeof window === "undefined" ? "" : window.location.hash}`;
  if (state.kind === "open") {
    const name = state.source.meta.name;
    const expires = left(state.expiresAt);
    const slots: WorkspaceSlots = {
      label: name,
      identity: <Identity name={name} expires={expires} />,
      bar: <span className="truncate type-label">{name}</span>,
      actions: <Button label={deleting ?? "Delete"} variant="destructive" icon={<Icon icon={Trash2} size="sm" />} onClick={() => void remove()} isDisabled={deleting === "Deleting…"} tooltip="Take it down now, for everyone with the link" />,
      hero: <Hero name={name} expires={expires} />,
      link,
    };
    return (
      <SourceContext value={state.source}>
        <App route={where} go={go} slots={slots} />
      </SourceContext>
    );
  }
  if (state.kind === "opening") {
    const slots: WorkspaceSlots = { label: "A Shared Report", identity: <Identity name={<Skeleton height={16} width={140} radius={1} />} />, bar: <span className="type-label text-secondary">Unlocking it in this browser…</span>, link };
    return (
      <Workspace slots={slots} route={where} screens={screensOf(false)}>
        <div aria-busy="true" aria-label="Unlocking">
          <ScreenColumn wide={where.screen === "universe"}>
            <ScreenHeader title={where.screen === "overview" ? "A Shared Report" : TITLES[where.screen]} counts="Unlocking it in this browser…" />
            <Opening />
          </ScreenColumn>
        </div>
      </Workspace>
    );
  }
  if (state.kind === "deleted") return <Notice eyebrow="A Shared Report" title="Deleted" words="This link no longer opens anything. Anyone who had it now sees that it is gone." actions={<Button label="Go home" variant="secondary" href="/" />} />;
  const words = state.kind === "error" ? state.words : "";
  return (
    <Notice
      eyebrow="A Shared Report"
      title="This Shared Report did not open"
      words={words}
      actions={
        <>
          <Button label="Go home" variant="primary" href="/" />
          <Button label="How Shared Reports are kept" variant="secondary" href="/privacy#shared" />
        </>
      }
    />
  );
}
