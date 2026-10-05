import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ApiError } from "@/lib/api";

/**
 * S3-compatible object storage.
 *
 * Every value comes from the environment (`S3_ENDPOINT`, `S3_BUCKET`,
 * `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_BASE_URL`, plus optional
 * `S3_REGION` / `S3_FORCE_PATH_STYLE` / `S3_KEY_PREFIX`), so the same code
 * works against AWS, MinIO, Cloudflare R2, or Wasabi.
 *
 * Uploads go here and nowhere else. Nothing in the upload path can write into
 * the repository working tree — that is a design rule, not an accident.
 */

interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  forcePathStyle: boolean;
  keyPrefix: string;
}

let cachedClient: S3Client | null = null;
let cachedKey: string | null = null;

function readConfig(): StorageConfig {
  const {
    S3_ENDPOINT,
    S3_BUCKET,
    S3_ACCESS_KEY,
    S3_SECRET_KEY,
    S3_PUBLIC_BASE_URL,
    S3_REGION,
    S3_FORCE_PATH_STYLE,
    S3_KEY_PREFIX,
  } = process.env;

  const missing = (
    [
      ["S3_ENDPOINT", S3_ENDPOINT],
      ["S3_BUCKET", S3_BUCKET],
      ["S3_ACCESS_KEY", S3_ACCESS_KEY],
      ["S3_SECRET_KEY", S3_SECRET_KEY],
      ["S3_PUBLIC_BASE_URL", S3_PUBLIC_BASE_URL],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    // Configuration fault, not a caller error — and the message names the
    // variables so the fix is obvious without reading this file.
    throw new ApiError(503, `Object storage is not configured (missing ${missing.join(", ")}).`, {
      code: "storage_not_configured",
      details: { missing },
    });
  }

  return {
    endpoint: S3_ENDPOINT as string,
    region: S3_REGION || "us-east-1",
    bucket: S3_BUCKET as string,
    accessKeyId: S3_ACCESS_KEY as string,
    secretAccessKey: S3_SECRET_KEY as string,
    publicBaseUrl: (S3_PUBLIC_BASE_URL as string).replace(/\/+$/, ""),
    forcePathStyle: S3_FORCE_PATH_STYLE === "true",
    keyPrefix: (S3_KEY_PREFIX ?? "uploads").replace(/^\/+|\/+$/g, ""),
  };
}

function getClient(config: StorageConfig): S3Client {
  // Cache keyed on the config so a changed env in dev does not reuse a stale client.
  const signature = `${config.endpoint}|${config.region}|${config.forcePathStyle}`;
  if (cachedClient && cachedKey === signature) return cachedClient;

  cachedClient = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  cachedKey = signature;
  return cachedClient;
}

/** `uploads/2026/10/<uuid>.jpg` — date-sharded so a bucket listing stays usable. */
export function buildObjectKey(extension: string, now: Date = new Date()): string {
  const prefix = (process.env.S3_KEY_PREFIX ?? "uploads").replace(/^\/+|\/+$/g, "");
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const name = `${globalThis.crypto.randomUUID()}.${extension}`;
  return [prefix, String(year), month, name].filter(Boolean).join("/");
}

export interface StoredObject {
  key: string;
  url: string;
}

export async function putObject(
  body: Buffer,
  options: { extension: string; contentType: string },
): Promise<StoredObject> {
  const config = readConfig();
  const key = buildObjectKey(options.extension);
  const client = getClient(config);

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        // Objects are publicly readable through S3_PUBLIC_BASE_URL (a CDN or a
        // public-read bucket policy). Uploads are never listed or indexed.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  } catch (error) {
    console.error("[uploads] S3 PutObject failed:", error);
    throw new ApiError(502, "The image could not be stored. Try again, or contact the practice administrator.", {
      code: "storage_write_failed",
    });
  }

  return { key, url: `${config.publicBaseUrl}/${key}` };
}
