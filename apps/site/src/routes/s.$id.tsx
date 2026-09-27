/**
 * `/s/<id>#<key>`: a Shared Report (ADR-0016). The locked bytes come from
 * the Site; the key never left this browser. They are unlocked here with
 * WebCrypto and read like any Report, with when they expire and a Delete
 * button, which sends the Delete Token the key gives.
 */
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { deleteToken, readReport, reportSource, unlock, type DataSource } from "@commitscape/data";
import { App, SourceContext } from "@commitscape/ui";
import { Connect } from "../components/Connect";
import { Frame } from "../components/Frame";
import { shareKey } from "../share-key";

export const Route = createFileRoute("/s/$id")({ component: SharedReport });

type State =
  | { kind: "opening" }
  | { kind: "open"; source: DataSource; expiresAt: number }
  | { kind: "deleted" }
  | { kind: "error"; words: string };

function left(expiresAt: number): string {
  const s = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function SharedReport() {
  const { id } = Route.useParams();
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
        return set({
          kind: "error",
          words: "This Shared Report could not be unlocked: the link's key is not its key, or what is stored was changed.",
        });
      }
      set({ kind: "open", source: reportSource(await readReport(plain)), expiresAt });
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
    const answer = await fetch(`/api/shares/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-delete-token": await deleteToken(key) },
    });
    if (answer.ok) setState({ kind: "deleted" });
    else setDeleting(((await answer.json()) as { error?: string }).error ?? "It could not be deleted.");
  };

  if (state.kind === "open") {
    return (
      <SourceContext value={state.source}>
        <App
          home="/"
          nav={
            <>
              <span className="note small">shared · expires in {left(state.expiresAt)}</span>
              <Button label={deleting ?? "Delete"} variant="destructive" size="sm" onClick={() => void remove()} isDisabled={deleting === "Deleting…"} />
              <Connect />
            </>
          }
        />
      </SourceContext>
    );
  }
  return (
    <Frame>
      <section className="repo-waiting">
        <Heading level={1}>A Shared Report</Heading>
        {state.kind === "opening" && <p className="note">Unlocking it in this browser…</p>}
        {state.kind === "deleted" && <Banner status="success" title="Deleted: this link no longer opens anything." />}
        {state.kind === "error" && <Banner status="warning" title={state.words} />}
        <p className="note">
          A Shared Report is locked on the machine that made it, with a key that only its link holds. The Site stores what it
          cannot read.
        </p>
      </section>
    </Frame>
  );
}
