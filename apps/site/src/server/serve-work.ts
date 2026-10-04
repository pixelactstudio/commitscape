import "@tanstack/react-start/server-only";
import { workMarkdown, type Work } from "@commitscape/data";
import { env } from "./env";
import { says } from "./http";
import { workPdf } from "./work-pdf";

/** A Proof of Work as a Markdown or PDF download. */
export async function serveWork(work: Work, file: string): Promise<Response> {
  const site = new URL(env.BETTER_AUTH_URL).origin;
  const name = `proof-of-work-${work.login}-${work.from}-to-${work.to}`;
  const headers = { "cache-control": work.scope === "self" ? "private, no-store" : "public, max-age=600", "x-content-type-options": "nosniff" };
  if (file === "proof.md") return new Response(workMarkdown(work, site), { headers: { ...headers, "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${name}.md"` } });
  if (file === "proof.pdf") return new Response((await workPdf(work, site)) as BodyInit, { headers: { ...headers, "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}.pdf"` } });
  return says(404, "Ask for proof.md or proof.pdf.");
}
