import sharp from "sharp";
import { ApiError } from "@/lib/api";

/**
 * Image intake.
 *
 * Two guarantees, both required before anything reaches object storage:
 *
 *  1. **The declared type is not trusted.** `file.type` and the filename come
 *     from the client; a `.png` that is really a PHP script (or an SVG carrying
 *     script) must not be stored as an image. `detectImageType` reads the magic
 *     bytes instead, and anything not in the allow-list is refused outright.
 *
 *  2. **Metadata is stripped.** Phone photos embed GPS coordinates, device
 *     serials, and timestamps. Re-encoding through sharp drops all of it unless
 *     `withMetadata()` is called, which it deliberately is not — and `.rotate()`
 *     bakes the EXIF orientation into the pixels first, so removing the tag
 *     cannot rotate the image.
 */

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Default cap; overridable with `UPLOAD_MAX_BYTES`. */
export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function maxUploadBytes(): number {
  const configured = Number(process.env.UPLOAD_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_BYTES;
}

const EXTENSION_BY_TYPE: Record<AllowedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function ascii(buffer: Buffer, offset: number, length: number): string {
  return buffer.subarray(offset, offset + length).toString("latin1");
}

/**
 * Identify an image from its leading bytes.
 *
 * Returns `null` for anything else — including SVG, which is an image by MIME
 * type but is XML and therefore script-capable; it is not accepted here.
 */
export function detectImageType(buffer: Buffer): AllowedImageType | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer[0] === 0x89 && ascii(buffer, 1, 3) === "PNG") return "image/png";
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WEBP") return "image/webp";
  const gifHeader = ascii(buffer, 0, 6);
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return "image/gif";

  return null;
}

const FORMAT_BY_TYPE: Record<AllowedImageType, "jpeg" | "png" | "webp" | "gif"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface ProcessedImage {
  buffer: Buffer;
  mime: AllowedImageType;
  extension: string;
  width: number | null;
  height: number | null;
  /** Bytes as received, for the log line. */
  originalBytes: number;
}

/**
 * Validate and normalise an uploaded image: sniff the type, enforce the size
 * ceiling, apply the EXIF orientation, and re-encode without metadata.
 */
export async function processImageUpload(input: Buffer, filename: string): Promise<ProcessedImage> {
  if (input.length === 0) {
    throw new ApiError(422, "The uploaded file is empty.", { details: { filename } });
  }

  const limit = maxUploadBytes();
  if (input.length > limit) {
    throw new ApiError(
      413,
      `Images must be ${Math.floor(limit / (1024 * 1024))} MB or smaller.`,
      { details: { filename, maxBytes: limit, actualBytes: input.length } },
    );
  }

  const mime = detectImageType(input);
  if (!mime) {
    throw new ApiError(
      415,
      "Unsupported file type. Upload a JPEG, PNG, WebP, or GIF image (the file's contents are checked, not its name).",
      { details: { filename, allowed: [...ALLOWED_IMAGE_TYPES] } },
    );
  }

  let pipeline: ReturnType<typeof sharp>;
  try {
    pipeline = sharp(input, { failOn: "error" });
    // Rotate first: this reads the EXIF orientation tag, turns the pixels the
    // right way up, and clears the tag — so dropping metadata loses nothing.
    pipeline = pipeline.rotate();
  } catch (error) {
    throw new ApiError(415, "The file could not be read as an image.", {
      details: { filename, reason: error instanceof Error ? error.message : "unknown" },
    });
  }

  let output: Buffer;
  let width: number | null = null;
  let height: number | null = null;
  try {
    const encoded = await pipeline
      .toFormat(FORMAT_BY_TYPE[mime])
      .toBuffer({ resolveWithObject: true });
    output = encoded.data;
    width = encoded.info.width ?? null;
    height = encoded.info.height ?? null;
  } catch (error) {
    throw new ApiError(422, "The image could not be processed.", {
      details: { filename, reason: error instanceof Error ? error.message : "unknown" },
    });
  }

  return {
    buffer: output,
    mime,
    extension: EXTENSION_BY_TYPE[mime],
    width,
    height,
    originalBytes: input.length,
  };
}
