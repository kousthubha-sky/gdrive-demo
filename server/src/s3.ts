import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.js";

export const s3 = new S3Client({
  region: env.AWS_REGION,
  // Set S3_ENDPOINT to point at an S3-compatible store (Cloudflare R2, MinIO).
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

/** Namespaced by user so one listing/prefix can never leak across accounts. */
export function buildStorageKey(userId: string, filename: string) {
  return `users/${userId}/${randomUUID()}${extname(filename).slice(0, 20)}`;
}

/**
 * `body` is a stream and `contentLength` is required so the SDK never has to
 * buffer the whole object to work out how long it is.
 */
export async function putObject(
  key: string,
  body: Readable,
  contentType: string,
  contentLength: number
) {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: contentLength,
    })
  );
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

/**
 * RFC 6266 form. HTTP header values are Latin-1, so a name with any non-ASCII
 * character has to travel in `filename*`; the plain `filename` is the ASCII
 * fallback for clients that don't read the extended form.
 */
function contentDisposition(disposition: "inline" | "attachment", filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Time-limited download URL. The bucket stays fully private; nothing is ever
 * public-read, so a leaked key expires on its own.
 */
export function signedDownloadUrl(key: string, filename: string, disposition: "inline" | "attachment") {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: contentDisposition(disposition, filename),
    }),
    { expiresIn: 300 }
  );
}
