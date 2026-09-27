/** A stand-in for R2 in memory, for unit tests and CPU measurements. */
export function testR2(): R2Bucket & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  const object = (key: string, bytes: Uint8Array) => ({
    key,
    size: bytes.length,
    httpEtag: `"${bytes.length}"`,
    body: new Blob([bytes as BlobPart]).stream(),
    arrayBuffer: async () => bytes.slice().buffer,
    text: async () => new TextDecoder().decode(bytes),
  });
  return {
    objects,
    get: async (key: string) => {
      const bytes = objects.get(key);
      return bytes ? object(key, bytes) : null;
    },
    head: async (key: string) => {
      const bytes = objects.get(key);
      return bytes ? object(key, bytes) : null;
    },
    put: async (key: string, value: ArrayBuffer | Uint8Array | ReadableStream | string) => {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof ReadableStream
            ? new Uint8Array(await new Response(value).arrayBuffer())
            : new Uint8Array(value as ArrayBuffer);
      objects.set(key, bytes);
      return object(key, bytes);
    },
    delete: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
  } as unknown as R2Bucket & { objects: Map<string, Uint8Array> };
}
