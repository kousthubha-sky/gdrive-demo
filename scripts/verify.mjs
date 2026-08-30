/**
 * End-to-end check of every file route against the real database and the real
 * S3 bucket.
 *
 * Google's login page cannot be driven from a script, so this mints its own
 * session cookie with JWT_SECRET - exactly the token the OAuth callback would
 * have issued. Everything after that is the same code path a browser takes.
 *
 * It creates two throwaway users and one small file, and removes all three at
 * the end. It never touches anything it did not create: notably it does not
 * call empty-trash, which would take your real files with it.
 *
 *   npm run dev          # in another terminal
 *   npm run verify
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

for (const candidate of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const BASE = process.env.VERIFY_URL ?? "http://localhost:4000";
const prisma = new PrismaClient();

let passed = 0;
const failures = [];

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL  ${name}\n        ${err.message.split("\n")[0]}`);
  }
}

function client(userId) {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: "10m" });
  return async (path, init = {}) => {
    const res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: { cookie: `gd_session=${token}`, ...(init.headers ?? {}) },
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${body?.error ?? ""}`);
    return body;
  };
}

const stamp = Date.now();
const NAME = `verify-${stamp}.txt`;
const CONTENT = `written by verify.mjs at ${new Date().toISOString()}`;

let alice;
let bob;
let fileId;

try {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`\nNo server at ${BASE}. Start it with "npm run dev", then run this again.\n`);
    process.exit(1);
  }

  alice = await prisma.user.create({
    data: { googleId: `verify-a-${stamp}`, email: `verify-a-${stamp}@example.invalid`, name: "Verify A" },
  });
  bob = await prisma.user.create({
    data: { googleId: `verify-b-${stamp}`, email: `verify-b-${stamp}@example.invalid`, name: "Verify B" },
  });

  const a = client(alice.id);
  const b = client(bob.id);

  console.log(`\nVerifying ${BASE}\n`);

  await step("rejects a request with no session", async () => {
    const res = await fetch(`${BASE}/api/files`);
    assert.equal(res.status, 401);
  });

  await step("uploads a file to S3", async () => {
    const form = new FormData();
    form.append("file", new Blob([CONTENT], { type: "text/plain" }), NAME);
    const file = await a("/files", { method: "POST", body: form });
    assert.equal(file.name, NAME);
    assert.equal(file.size, Buffer.byteLength(CONTENT));
    fileId = file.id;
  });

  await step("finds it by a partial name search", async () => {
    const hits = await a(`/files?q=${encodeURIComponent(`verify-${stamp}`)}`);
    assert.equal(hits.length, 1, `expected 1 hit, got ${hits.length}`);
    assert.equal(hits[0].id, fileId);
  });

  await step("does not match an unrelated search term", async () => {
    const hits = await a(`/files?q=nothing-called-this-${stamp}`);
    assert.equal(hits.length, 0);
  });

  await step("downloads the exact bytes through a presigned URL", async () => {
    const { url } = await a(`/files/${fileId}/url`);
    assert.match(url, /X-Amz-Signature/, "URL is not presigned");
    const body = await fetch(url).then((r) => r.text());
    assert.equal(body, CONTENT);
  });

  await step("renames it", async () => {
    const renamed = await a(`/files/${fileId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `renamed-${stamp}.txt` }),
    });
    assert.equal(renamed.name, `renamed-${stamp}.txt`);
  });

  await step("rejects a rename to an empty name", async () => {
    await assert.rejects(
      () =>
        a(`/files/${fileId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "   " }),
        }),
      /400/
    );
  });

  await step("stars it and lists it under starred", async () => {
    await a(`/files/${fileId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ starred: true }),
    });
    const starred = await a("/files?scope=starred");
    assert.ok(starred.some((f) => f.id === fileId), "file missing from starred");
  });

  await step("hides the file from a stranger", async () => {
    await assert.rejects(() => b(`/files/${fileId}/url`), /404/);
  });

  await step("shares it, and the recipient can then read it", async () => {
    const shared = await a(`/files/${fileId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: bob.email }),
    });
    assert.equal(shared.shares.length, 1);

    const inbox = await b("/files?scope=shared");
    assert.ok(inbox.some((f) => f.id === fileId), "file missing from recipient's shared list");
  });

  await step("does not leak the collaborator list to the recipient", async () => {
    const inbox = await b("/files?scope=shared");
    const seen = inbox.find((f) => f.id === fileId);
    assert.deepEqual(seen.shares, [], "recipient can see who else it was shared with");
  });

  await step("refuses to let the recipient rename or delete it", async () => {
    await assert.rejects(
      () =>
        b(`/files/${fileId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "hijacked.txt" }),
        }),
      /404/
    );
    await assert.rejects(() => b(`/files/${fileId}`, { method: "DELETE" }), /404/);
  });

  await step("revokes the share", async () => {
    await a(`/files/${fileId}/shares/${bob.id}`, { method: "DELETE" });
    const inbox = await b("/files?scope=shared");
    assert.ok(!inbox.some((f) => f.id === fileId), "file still visible after revoke");
  });

  await step("moves it to trash and out of My Drive", async () => {
    const trashed = await a(`/files/${fileId}`, { method: "DELETE" });
    assert.ok(trashed.trashedAt, "trashedAt was not set");

    const mine = await a("/files?scope=mine");
    assert.ok(!mine.some((f) => f.id === fileId), "trashed file still in My Drive");

    const bin = await a("/files?scope=trash");
    assert.ok(bin.some((f) => f.id === fileId), "trashed file missing from Trash");
  });

  await step("keeps the S3 object while the file is in the trash", async () => {
    const { url } = await a(`/files/${fileId}/url`);
    const res = await fetch(url);
    assert.equal(res.status, 200, "object was removed on a soft delete");
  });

  await step("restores it", async () => {
    const restored = await a(`/files/${fileId}/restore`, { method: "POST" });
    assert.equal(restored.trashedAt, null);

    const mine = await a("/files?scope=mine");
    assert.ok(mine.some((f) => f.id === fileId), "restored file missing from My Drive");
  });

  await step("reports storage that includes the file", async () => {
    const { used, quota } = await a("/files/storage");
    assert.ok(quota > 0, "quota not set");
    assert.ok(used >= Buffer.byteLength(CONTENT), `used (${used}) excludes the uploaded file`);
  });

  await step("deletes it for good, object and all", async () => {
    const { url } = await a(`/files/${fileId}/url`);
    await a(`/files/${fileId}`, { method: "DELETE" });
    await a(`/files/${fileId}/permanent`, { method: "DELETE" });
    fileId = null;

    const bin = await a("/files?scope=trash");
    assert.equal(bin.length, 0, "file still in trash after permanent delete");

    // The URL was signed while the object existed, so a 200 here would mean
    // the bytes outlived the row.
    const res = await fetch(url);
    assert.ok(res.status === 403 || res.status === 404, `S3 object survived (${res.status})`);
  });
} finally {
  if (fileId) {
    const a = client(alice.id);
    await a(`/files/${fileId}/permanent`, { method: "DELETE" }).catch(() => {});
  }
  // Files cascade with their owner, so this also clears anything left behind.
  if (alice) await prisma.user.delete({ where: { id: alice.id } }).catch(() => {});
  if (bob) await prisma.user.delete({ where: { id: bob.id } }).catch(() => {});
  await prisma.$disconnect();
}

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const { name, err } of failures) console.error(`${name}:\n${err.stack}\n`);
  process.exit(1);
}
