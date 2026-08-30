import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { HttpError } from "../errors.js";
import { buildStorageKey, deleteObject, putObject, signedDownloadUrl } from "../s3.js";
import { filename } from "../validation.js";

export const filesRouter = Router();
filesRouter.use(requireAuth);

const upload = multer({
  // Spooled to a temp file, not held in memory: peak heap stays flat no matter
  // how large the upload is or how many arrive at once. multer unlinks the temp
  // file itself when a request trips the size limit.
  storage: multer.diskStorage({}),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
});

const fileSelect = {
  id: true,
  name: true,
  mimeType: true,
  size: true,
  starred: true,
  trashedAt: true,
  createdAt: true,
  updatedAt: true,
  ownerId: true,
  owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
  shares: { select: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
} as const;

/** A user may read a file if they own it or it has been shared with them. */
const readableBy = (userId: string) => ({
  OR: [{ ownerId: userId }, { shares: { some: { userId } } }],
});

/**
 * Every file leaves through here. `size` is a BigInt column, which JSON cannot
 * serialise, and the collaborator list is the owner's business only - someone a
 * file was shared with must not learn who else it was shared with.
 */
function toJson<T extends { ownerId: string; size: bigint; shares: unknown[] }>(
  file: T,
  viewerId: string
) {
  return {
    ...file,
    size: Number(file.size),
    shares: file.ownerId === viewerId ? file.shares : [],
  };
}

/** Prisma drops `contains` straight into ILIKE, where % and _ are wildcards. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// Both lookups below 404 rather than 403 on purpose: never confirm that
// someone else's file id exists.

/** Ownership gate for the mutating routes. Selects an id, so it joins nothing. */
async function assertOwner(fileId: string, userId: string) {
  const owned = await prisma.file.findFirst({
    where: { id: fileId, ownerId: userId },
    select: { id: true },
  });
  if (!owned) throw new HttpError(404, "File not found");
}

/** The file as the client sees it. `storageKey` is never part of this shape. */
async function readableFile(fileId: string, userId: string) {
  const file = await prisma.file.findFirst({
    where: { id: fileId, ...readableBy(userId) },
    select: fileSelect,
  });
  if (!file) throw new HttpError(404, "File not found");
  return file;
}

const listQuery = z.object({
  q: z.string().trim().max(255).optional(),
  scope: z.enum(["mine", "shared", "all", "trash", "starred", "recent"]).default("all"),
});

// GET /api/files?q=report&scope=mine
filesRouter.get("/", async (req: Request, res: Response) => {
  const { q, scope } = listQuery.parse(req.query);
  const me = req.auth!.id;

  // Trash is the owner's own bin, so a file shared with you never appears in
  // it; every other view hides trashed files entirely.
  const ownership =
    scope === "trash"
      ? [{ ownerId: me }]
      : scope === "mine" || scope === "starred"
        ? [{ ownerId: me }]
        : scope === "shared"
          ? [{ shares: { some: { userId: me } } }]
          : readableBy(me).OR;

  const files = await prisma.file.findMany({
    where: {
      OR: ownership,
      trashedAt: scope === "trash" ? { not: null } : null,
      ...(scope === "starred" ? { starred: true } : {}),
      ...(q ? { name: { contains: escapeLike(q), mode: "insensitive" as const } } : {}),
    },
    select: fileSelect,
    orderBy: scope === "recent" ? { updatedAt: "desc" } : { createdAt: "desc" },
    take: scope === "recent" ? 25 : 500,
  });

  res.json(files.map((file) => toJson(file, me)));
});

// GET /api/files/storage  -> what the sidebar meter shows.
// Declared before /:id routes so "storage" is never read as a file id.
filesRouter.get("/storage", async (req: Request, res: Response) => {
  const { _sum } = await prisma.file.aggregate({
    where: { ownerId: req.auth!.id },
    _sum: { size: true },
  });
  res.json({ used: Number(_sum.size ?? 0n), quota: env.STORAGE_QUOTA_BYTES });
});

// POST /api/files   (multipart/form-data, field name "file")
filesRouter.post("/", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) throw new HttpError(400, "No file was uploaded (expected field \"file\")");

  const { path, size } = req.file;
  const name = filename.parse(req.file.originalname);
  const key = buildStorageKey(req.auth!.id, name);
  const mimeType = req.file.mimetype || "application/octet-stream";

  try {
    await putObject(key, createReadStream(path), mimeType, size);

    try {
      const file = await prisma.file.create({
        data: { name, storageKey: key, mimeType, size, ownerId: req.auth!.id },
        select: fileSelect,
      });
      res.status(201).json(toJson(file, req.auth!.id));
    } catch (err) {
      // Don't leave an orphaned object in the bucket if the metadata write fails.
      await deleteObject(key).catch(() => {});
      throw err;
    }
  } finally {
    await unlink(path).catch(() => {});
  }
});

// GET /api/files/:id/url  -> short-lived signed S3 URL
filesRouter.get("/:id/url", async (req: Request<{ id: string }>, res: Response) => {
  const file = await prisma.file.findFirst({
    where: { id: req.params.id, ...readableBy(req.auth!.id) },
    select: { name: true, storageKey: true },
  });
  if (!file) throw new HttpError(404, "File not found");

  const disposition = req.query.disposition === "inline" ? "inline" : "attachment";
  res.json({ url: await signedDownloadUrl(file.storageKey, file.name, disposition) });
});

// PATCH /api/files/:id  { name?, starred? }
const patchBody = z
  .object({ name: filename.optional(), starred: z.boolean().optional() })
  .refine((b) => b.name !== undefined || b.starred !== undefined, "Nothing to update");

filesRouter.patch("/:id", async (req: Request<{ id: string }>, res: Response) => {
  const patch = patchBody.parse(req.body);
  await assertOwner(req.params.id, req.auth!.id);

  const file = await prisma.file.update({
    where: { id: req.params.id },
    data: patch,
    select: fileSelect,
  });
  res.json(toJson(file, req.auth!.id));
});

/**
 * Metadata first: a row without an object is a broken download, an object
 * without a row is an invisible orphan. Neither is great, but the database is
 * the source of truth, so it goes first and the bucket is best-effort.
 */
async function purge(where: { id: string } | { ownerId: string; trashedAt: { not: null } }) {
  const doomed = await prisma.file.findMany({ where, select: { id: true, storageKey: true } });
  if (doomed.length === 0) return 0;

  await prisma.file.deleteMany({ where: { id: { in: doomed.map((f) => f.id) } } });
  await Promise.all(
    doomed.map((f) =>
      deleteObject(f.storageKey).catch((err) =>
        console.error(`Orphaned S3 object ${f.storageKey}:`, err)
      )
    )
  );
  return doomed.length;
}

// DELETE /api/files/trash  -> empty the trash. Before /:id so it is not a file id.
filesRouter.delete("/trash", async (req: Request, res: Response) => {
  const deleted = await purge({ ownerId: req.auth!.id, trashedAt: { not: null } });
  res.json({ deleted });
});

// DELETE /api/files/:id  -> move to trash. Reversible, and the S3 object stays.
filesRouter.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  await assertOwner(req.params.id, req.auth!.id);

  const file = await prisma.file.update({
    where: { id: req.params.id },
    data: { trashedAt: new Date() },
    select: fileSelect,
  });
  res.json(toJson(file, req.auth!.id));
});

// POST /api/files/:id/restore  -> back out of the trash
filesRouter.post("/:id/restore", async (req: Request<{ id: string }>, res: Response) => {
  await assertOwner(req.params.id, req.auth!.id);

  const file = await prisma.file.update({
    where: { id: req.params.id },
    data: { trashedAt: null },
    select: fileSelect,
  });
  res.json(toJson(file, req.auth!.id));
});

// DELETE /api/files/:id/permanent  -> gone for good, object and all
filesRouter.delete("/:id/permanent", async (req: Request<{ id: string }>, res: Response) => {
  await assertOwner(req.params.id, req.auth!.id);
  await purge({ id: req.params.id });
  res.status(204).end();
});

// POST /api/files/:id/shares   { email }   (bonus: sharing)
const shareBody = z.object({ email: z.string().trim().toLowerCase().email() });
filesRouter.post("/:id/shares", async (req: Request<{ id: string }>, res: Response) => {
  const { email } = shareBody.parse(req.body);
  await assertOwner(req.params.id, req.auth!.id);

  if (email === req.auth!.email.toLowerCase()) {
    throw new HttpError(400, "You already own this file");
  }

  const recipient = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!recipient) {
    throw new HttpError(404, `${email} has not signed in to this app yet, so they can't be shared with`);
  }

  await prisma.share.upsert({
    where: { fileId_userId: { fileId: req.params.id, userId: recipient.id } },
    update: {},
    create: { fileId: req.params.id, userId: recipient.id },
  });

  res.status(201).json(toJson(await readableFile(req.params.id, req.auth!.id), req.auth!.id));
});

// DELETE /api/files/:id/shares/:userId
filesRouter.delete("/:id/shares/:userId", async (req: Request<{ id: string; userId: string }>, res: Response) => {
  await assertOwner(req.params.id, req.auth!.id);
  await prisma.share
    .delete({ where: { fileId_userId: { fileId: req.params.id, userId: req.params.userId } } })
    .catch(() => {});
  res.status(204).end();
});
