import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export type PutOptions = { type: string; encoding?: string };

export type StoredObject = { body: Uint8Array; type: string | undefined; encoding: string | undefined };

export interface Storage {
  put(key: string, body: Uint8Array | string, options: PutOptions): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(keys: string[]): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

export type S3Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  forcePathStyle?: boolean;
};

/** Storage in an S3 bucket: R2 in production, s3mock in development and tests. */
export function s3Storage(config: S3Config): Storage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region ?? "auto",
    forcePathStyle: config.forcePathStyle ?? false,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const Bucket = config.bucket;
  const remove = async (keys: string[]) => {
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      if (chunk.length > 0) await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
    }
  };
  return {
    async put(key, body, options) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: options.type, ContentEncoding: options.encoding }),
      );
    },
    async get(key) {
      try {
        const answer = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        if (!answer.Body) return null;
        return { body: await answer.Body.transformToByteArray(), type: answer.ContentType, encoding: answer.ContentEncoding };
      } catch (e) {
        if (e instanceof NoSuchKey) return null;
        throw e;
      }
    },
    delete: remove,
    async deletePrefix(prefix) {
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        await remove((page.Contents ?? []).flatMap((o) => (o.Key ? [o.Key] : [])));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
  };
}

/** Storage in memory, for tests. */
export function memoryStorage(): Storage & { objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    async put(key, body, options) {
      objects.set(key, { body: typeof body === "string" ? new TextEncoder().encode(body) : body, type: options.type, encoding: options.encoding });
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async delete(keys) {
      for (const k of keys) objects.delete(k);
    },
    async deletePrefix(prefix) {
      for (const k of [...objects.keys()]) if (k.startsWith(prefix)) objects.delete(k);
    },
  };
}
