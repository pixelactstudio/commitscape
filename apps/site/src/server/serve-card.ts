import "@tanstack/react-start/server-only";
import type { CardKind } from "@commitscape/data";
import { cardImage, type Subject } from "./cards";
import { env } from "./env";
import { answer, says } from "./http";
import { deps } from "./viewer";

const FILE = /^([a-z0-9-]+)\.(svg|png)$/;

/** Answers a request for a Card image, when its kind is one of those allowed for the address. */
export function serveCard(request: Request, file: string, allowed: readonly CardKind[], subject: Subject): Promise<Response> {
  return answer(async () => {
    const m = FILE.exec(file);
    const achievement = m?.[1]?.startsWith("achievement-") ? m[1].slice("achievement-".length) : undefined;
    const kind = (achievement ? "achievement" : m?.[1]) as CardKind | undefined;
    if (!m || !kind || !allowed.includes(kind)) return says(404, "No such Card.");
    const theme = new URL(request.url).searchParams.get("theme") === "dark" ? "dark" : "light";
    const card = await cardImage({ ...deps(), site: new URL(env.BETTER_AUTH_URL).host }, kind, achievement ? { ...subject, achievement } : subject, theme, m[2] as "svg" | "png");
    return new Response(card.body as BodyInit, {
      headers: {
        "content-type": card.type,
        "cache-control": `public, max-age=${card.maxAge}`,
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        ...(card.ms !== null ? { "x-render-ms": card.ms.toFixed(1) } : {}),
      },
    });
  });
}
