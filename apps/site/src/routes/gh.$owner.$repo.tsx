/**
 * `/gh/<owner>/<repo>` (ADR-0015): a public repository's Report, the same
 * six screens as the local page, read through the fetched-Report Data
 * Source. GitHub's facts show at once; a first Build's progress shows
 * until its Report is there; an older Report shows "updating" while a
 * newer one is built. Each way a Build can fail has its plain message.
 */
import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { Spinner } from "@astryxdesign/core/Spinner";
import { FAILURE_WORDS, fetchReport, type DataSource, type Lookup } from "@commitscape/data";
import { App, SourceContext } from "@commitscape/ui";
import { Connect } from "../components/Connect";
import { Facts } from "../components/Facts";
import { Frame } from "../components/Frame";

export const Route = createFileRoute("/gh/$owner/$repo")({ component: Repository });

const STEPS: Record<string, string> = {
  queued: "Waiting for its turn to be read",
  reading: "Reading its history",
  uploading: "Storing its Report",
};

async function ask(base: string): Promise<Lookup> {
  const answer = await fetch(`/api/repos/${base}`);
  const body = (await answer.json()) as Lookup & { error?: string };
  if (!answer.ok) throw new Error(body.error ?? "The Site could not answer.");
  return body;
}

function Repository() {
  const { owner, repo } = Route.useParams();
  const base = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [source, setSource] = useState<{ at: number; source: DataSource } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);

  // What the Site knows, again every two seconds while a Build runs.
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        let l = await ask(base);
        if (l.canBuild && !asked.current) {
          asked.current = true;
          const started = await fetch("/api/builds", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ owner, name: repo }),
          });
          const body = (await started.json()) as Lookup & { error?: string };
          if (started.ok) l = body;
          else if (current) setError(body.error ?? null);
        }
        if (!current) return;
        setLookup(l);
        const running = l.build && (l.build.state === "queued" || l.build.state === "running");
        if (running) timer = setTimeout(() => void poll(), 2000);
      } catch (e) {
        if (current) setError((e as Error).message);
      }
    };
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [base, owner, repo]);

  // The Report, fetched once for each one built.
  const reportAt = lookup?.report?.at;
  useEffect(() => {
    if (reportAt === undefined || source?.at === reportAt) return;
    let current = true;
    fetchReport(`/api/reports/${base}?at=${reportAt}`)
      .then((s) => current && setSource({ at: reportAt, source: s }))
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [base, reportAt, source?.at]);

  const running = !!lookup?.build && (lookup.build.state === "queued" || lookup.build.state === "running");
  if (source && lookup) {
    const built = new Date(lookup.report ? lookup.report.at * 1000 : 0).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return (
      <SourceContext value={source.source}>
        <App
          home="/"
          nav={
            <>
              {running ? <Badge label="updating…" variant="info" /> : <span className="note small">built {built}</span>}
              {lookup.report && !lookup.report.lines && <Badge label="lines not counted" variant="neutral" />}
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
        <Heading level={1}>
          <a href={`https://github.com/${owner}/${repo}`}>
            {lookup?.owner ?? owner}/{lookup?.name ?? repo}
          </a>
        </Heading>
        {!lookup && !error && <p className="note">Asking the Site…</p>}
        {error && <Banner status="error" title={error} />}
        {lookup?.status === "not_found" && (
          <>
            <Banner status="warning" title={FAILURE_WORDS.not_found} />
            {lookup.access === "signed_out" && (
              <p>
                If it is a private repository of yours, <a href="/api/auth/github">sign in with GitHub</a> to see it.
              </p>
            )}
          </>
        )}
        {lookup?.status === "private" && (
          <>
            <Banner status="info" title={FAILURE_WORDS.private} />
            {lookup.access === "not_connected" && (
              <p>
                You can see it on GitHub; <a href="/me">add it through commitscape's GitHub App</a> to let the Site read it.
              </p>
            )}
          </>
        )}
        {lookup?.status === "ok" && running && (
          <p className="build-step">
            <Spinner size="sm" /> {STEPS[lookup.build?.step ?? lookup.build?.state ?? "queued"] ?? "Reading its history"}… Most
            repositories take seconds; a large one up to a minute, the first time.
          </p>
        )}
        {lookup?.status === "ok" && lookup.build?.state === "failed" && lookup.build.reason && (
          <Banner status={lookup.build.reason === "paused" ? "info" : "warning"} title={FAILURE_WORDS[lookup.build.reason]} />
        )}
        {lookup?.facts && <Facts facts={lookup.facts} />}
      </section>
    </Frame>
  );
}
