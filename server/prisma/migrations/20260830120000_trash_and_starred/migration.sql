-- AlterTable
ALTER TABLE "File" ADD COLUMN     "starred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trashedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "File_ownerId_trashedAt_idx" ON "File"("ownerId", "trashedAt");

