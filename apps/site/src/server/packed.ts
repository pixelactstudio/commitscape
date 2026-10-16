import "@tanstack/react-start/server-only";
import { promisify } from "node:util";
import { brotliCompress, brotliDecompress, constants, gunzip, gzip } from "node:zlib";

const brotliAsync = promisify(brotliCompress);
const unbrotliAsync = promisify(brotliDecompress);
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type Encoding = "br" | "gzip" | "identity";

export type Packed = { text: string | null; br: Promise<Uint8Array> | null; gzip: Promise<Uint8Array> | null; brBytes: number; gzipBytes: number; length: number };

const KEEP_TEXT = 16 * 1024;

const bytesOf = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

const brotli = (text: string, quality: number) =>
  brotliAsync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_SIZE_HINT]: text.length } }).then(bytesOf);

/** The best encoding a request accepts of those the Site sends: brotli, then gzip, else none. */
export function encodingOf(accept: string | null): Encoding {
  const offered = new Map<string, number>();
  for (const part of (accept ?? "").toLowerCase().split(",")) {
    const [name = "", ...rest] = part.trim().split(";");
    const q = rest.map((r) => r.trim()).find((r) => r.startsWith("q="));
    offered.set(name.trim(), q ? Number(q.slice(2)) : 1);
  }
  const wants = (name: string) => (offered.get(name) ?? offered.get("*") ?? 0) > 0;
  return wants("br") ? "br" : wants("gzip") ? "gzip" : "identity";
}

/** Starts packing a JSON text with brotli, off the main thread; `quality` trades time for size. */
export function pack(text: string, quality = 5): Packed {
  const p: Packed = { text, br: null, gzip: null, brBytes: 0, gzipBytes: 0, length: text.length };
  const br = brotli(text, quality);
  p.br = br;
  br.then(
    (b) => {
      p.brBytes = b.byteLength;
      if (p.text !== null && p.text.length > KEEP_TEXT) p.text = null;
    },
    () => {
      p.br = null;
    },
  );
  return p;
}

/** How many bytes a packed body holds now. */
export const heldBy = (p: Packed): number => (p.text?.length ?? 0) + p.brBytes + p.gzipBytes;

/** Waits until a packed body is ready to send in any encoding. */
export async function packed(p: Packed): Promise<Packed> {
  await p.br?.catch(() => undefined);
  return p;
}

async function textOf(p: Packed): Promise<string | Uint8Array> {
  if (p.text !== null) return p.text;
  if (p.br) return bytesOf(await unbrotliAsync(await p.br));
  if (p.gzip) return bytesOf(await gunzipAsync(await p.gzip));
  throw new Error("nothing packed");
}

/** The body to send for an encoding, made and kept the first time it is asked for. */
export async function bodyOf(p: Packed, encoding: Encoding): Promise<{ body: Uint8Array | string; encoding: Encoding }> {
  if (encoding === "br" && p.br) return { body: await p.br, encoding };
  if (encoding !== "identity") {
    if (!p.gzip) {
      const made = textOf(p)
        .then((text) => gzipAsync(text, { level: 6 }))
        .then(bytesOf);
      p.gzip = made;
      made.then(
        (b) => void (p.gzipBytes = b.byteLength),
        () => void (p.gzip = null),
      );
    }
    return { body: await p.gzip, encoding: "gzip" };
  }
  return { body: await textOf(p), encoding: "identity" };
}

/** A response with a packed JSON body in the best encoding the request accepts. */
export async function sendPacked(request: Request, p: Packed, headers: Record<string, string>): Promise<Response> {
  const { body, encoding } = await bodyOf(p, encodingOf(request.headers.get("accept-encoding")));
  return new Response(body as BodyInit, { headers: { ...headers, "content-type": "application/json", ...(encoding === "identity" ? {} : { "content-encoding": encoding }) } });
}
