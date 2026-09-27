/** The Builder's calls back to the Site, each signed (ADR-0015). */
import { SIGNATURE, sign, type BuildOutcome, type BuildStep } from "@commitscape/data";

export type Site = {
  progress(id: string, step: BuildStep): Promise<void>;
  upload(id: string, what: "report" | "card", bytes: Uint8Array, type: string, uploadToken: string): Promise<void>;
  done(id: string, outcome: BuildOutcome): Promise<void>;
};

/**
 * A call, tried again once, `wait` ms later, when the connection drops or
 * the Site answers 5xx: a dropped upload should not fail a whole Build. A
 * 4xx is the Site refusing, and stands. Each try is signed afresh.
 */
export async function twice(call: () => Promise<Response>, wait = 2000): Promise<Response> {
  try {
    const first = await call();
    if (first.status < 500) return first;
  } catch {
    // Tried again below.
  }
  await new Promise((r) => setTimeout(r, wait));
  return call();
}

export function site(origin: string, secret: string, fetcher: typeof fetch = fetch, wait = 2000): Site {
  const post = async (path: string, body: unknown) => {
    const text = JSON.stringify(body);
    const response = await twice(
      async () =>
        fetcher(`${origin}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", [SIGNATURE]: await sign(secret, "POST", path, text) },
          body: text,
        }),
      wait,
    );
    if (!response.ok) throw new Error(`the Site answered ${path} with ${response.status}: ${await response.text()}`);
  };
  return {
    progress: (id, step) => post(`/api/builds/${id}/progress`, { step }),
    done: (id, outcome) => post(`/api/builds/${id}/done`, outcome),
    async upload(id, what, bytes, type, uploadToken) {
      const path = `/api/builds/${id}/${what}`;
      const response = await twice(
        async () =>
          fetcher(`${origin}${path}`, {
            method: "PUT",
            headers: {
              "content-type": type,
              "content-length": String(bytes.length),
              "x-upload-token": uploadToken,
              [SIGNATURE]: await sign(secret, "PUT", path, `length:${bytes.length}`),
            },
            body: bytes as BodyInit,
          }),
        wait,
      );
      if (!response.ok) throw new Error(`the Site refused the ${what}: ${response.status} ${await response.text()}`);
    },
  };
}
